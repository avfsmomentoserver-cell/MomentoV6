"""SQLite repository for the afresh backend.

Replaces the Cloudflare Durable Object SQL store. One process-wide connection
(WAL, busy_timeout 5 s, synchronous NORMAL) guarded by a re-entrant lock, so
the route ports keep the DO's "one writer, serialised statements" semantics
while pure analytics run outside the lock on cached rounds.

The cursor API mirrors the DO's `sql.exec(q, ...args).toArray()` so ported
handlers stay line-for-line comparable with archive/backend-ts-v6.5.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA_VERSION = 1
SCHEMA_FILE = Path(__file__).with_name("schema.sql")

# idempotent historical migrations (archive core.ts:378, v64routes.ts:71)
_MIGRATIONS = (
    "ALTER TABLE rounds ADD COLUMN origin TEXT NOT NULL DEFAULT 'observed'",
    "ALTER TABLE intel_calibrations ADD COLUMN cal_loss REAL",
)


def _bind(v: Any) -> Any:
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"))
    if isinstance(v, float) and v.is_integer() and abs(v) < 2**53:
        # JS numbers bound to INTEGER columns arrive as doubles; keep ints exact
        return int(v)
    return v


class Result:
    """Cursor result with the Durable Object surface (toArray / rowsWritten)."""

    __slots__ = ("_rows", "rowsWritten", "lastrowid")

    def __init__(self, rows: list[dict], rows_written: int, lastrowid: int | None):
        self._rows = rows
        self.rowsWritten = rows_written
        self.lastrowid = lastrowid

    def toArray(self) -> list[dict]:  # noqa: N802 — DO API name
        return self._rows

    to_array = toArray

    def one(self) -> dict | None:
        return self._rows[0] if self._rows else None

    @property
    def rows_written(self) -> int:
        return self.rowsWritten


class Database:
    def __init__(self, path: str | Path = ":memory:"):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None, timeout=5.0)
        self._conn.row_factory = sqlite3.Row
        c = self._conn
        if self.path != ":memory:":
            c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=5000")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("PRAGMA temp_store=MEMORY")
        self._tx_depth = 0
        self.init_schema()

    # ------------------------------------------------------------- schema
    def init_schema(self) -> None:
        with self._lock:
            script = SCHEMA_FILE.read_text()
            try:
                self._conn.executescript(script)
            except sqlite3.OperationalError:
                # pre-v6.4 database: indexes on columns that do not exist yet
                self._migrate()
                self._conn.executescript(script)
            self._migrate()
            # idx_rounds_origin needs the column, so (re)create it after migrations
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_rounds_origin ON rounds (origin, ts_ms)")
            row = self._conn.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()
            if not row or row["v"] is None or row["v"] < SCHEMA_VERSION:
                import time
                self._conn.execute("INSERT INTO schema_version (version, applied_ms) VALUES (?, ?)", (SCHEMA_VERSION, int(time.time() * 1000)))

    def _migrate(self) -> None:
        for stmt in _MIGRATIONS:
            try:
                self._conn.execute(stmt)
            except sqlite3.OperationalError:
                pass  # column already exists / table missing

    # ------------------------------------------------------------- core API
    def exec(self, q: str, *args: Any) -> Result:
        """Run one statement (DO `sql.exec`). Multi-statement scripts without args use executescript."""
        with self._lock:
            if not args and q.count(";") > 1:
                self._conn.executescript(q)
                return Result([], 0, None)
            before = self._conn.total_changes
            cur = self._conn.execute(q, tuple(_bind(a) for a in args))
            rows = [dict(r) for r in cur.fetchall()] if cur.description else []
            written = self._conn.total_changes - before
            return Result(rows, written, cur.lastrowid)

    def rows(self, q: str, *args: Any) -> list[dict]:
        return self.exec(q, *args).toArray()

    def one(self, q: str, *args: Any) -> dict | None:
        return self.exec(q, *args).one()

    def scalar(self, q: str, *args: Any, default: Any = None) -> Any:
        r = self.one(q, *args)
        if not r:
            return default
        v = next(iter(r.values()))
        return default if v is None else v

    def run(self, q: str, *args: Any) -> int:
        """Execute a write; returns lastrowid (INSERT) — rowsWritten via exec()."""
        return self.exec(q, *args).lastrowid or 0

    @contextmanager
    def transaction(self) -> Iterator["Database"]:
        """`transactionSync` — nested calls join the outer transaction."""
        with self._lock:
            outer = self._tx_depth == 0
            if outer:
                self._conn.execute("BEGIN IMMEDIATE")
            self._tx_depth += 1
            try:
                yield self
            except BaseException:
                self._tx_depth -= 1
                if outer:
                    self._conn.execute("ROLLBACK")
                raise
            else:
                self._tx_depth -= 1
                if outer:
                    self._conn.execute("COMMIT")

    transactionSync = transaction

    # DO-style adapter: `a.sql.exec(...)` in ported handlers
    @property
    def sql(self) -> "Database":
        return self

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ------------------------------------------------------------- helpers
    def table_names(self) -> list[str]:
        return [r["name"] for r in self.rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]

    def backup_to(self, dest: str | Path) -> None:
        with self._lock:
            out = sqlite3.connect(str(dest))
            try:
                self._conn.backup(out)
            finally:
                out.close()
