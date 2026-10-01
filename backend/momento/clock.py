"""Wall clock with an optional per-request/per-job override (as_of / replay)."""

from __future__ import annotations

import contextvars
import datetime as _dt
import time

_override: contextvars.ContextVar[int | None] = contextvars.ContextVar("momento_now_ms", default=None)


def now_ms() -> int:
    v = _override.get()
    return int(v) if v is not None else int(time.time() * 1000)


def iso(ms: float | int | None = None) -> str:
    """new Date(ms).toISOString()"""
    ms = now_ms() if ms is None else int(ms)
    d = _dt.datetime.fromtimestamp(ms // 1000, _dt.timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def now_iso() -> str:
    return iso(now_ms())


def parse_iso_ms(s: str | None) -> int | None:
    """Date.parse for ISO strings (Z or offset); None when unparseable."""
    if not s:
        return None
    try:
        t = s.strip().replace("Z", "+00:00")
        if " " in t and "T" not in t:
            t = t.replace(" ", "T", 1)
        d = _dt.datetime.fromisoformat(t)
        if d.tzinfo is None:
            d = d.replace(tzinfo=_dt.timezone.utc)
        return int(d.timestamp() * 1000)
    except ValueError:
        return None


class frozen:
    """with frozen(ms): … — pins now_ms() for the block (backtests, as_of)."""

    def __init__(self, ms: int | None):
        self.ms = ms
        self._tok = None

    def __enter__(self):
        self._tok = _override.set(self.ms)
        return self

    def __exit__(self, *exc):
        _override.reset(self._tok)
        return False
