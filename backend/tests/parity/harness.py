"""Golden parity harness: call archived TS modules and compare with the Python port."""

from __future__ import annotations

import json
import math
import random
import subprocess
from pathlib import Path

from momento.analysis import Round
from momento.jsutil import to_plain

HERE = Path(__file__).parent
BUILD = HERE / ".ts-build"


def ensure_build() -> None:
    if not (BUILD / "intelligence.mjs").exists():
        subprocess.run(["node", str(HERE / "build_ts.mjs")], check=True)


def tape(n: int, seed: int = 7, edge: float = 0.03, start_ms: int = 1_780_000_000_000, step_ms: int = 9000, source: str = "aviator", drift: float = 0.0) -> list[dict]:
    """Synthetic crash tape: floor(100 * (1-e) / u) / 100, min 1.00 (same law as archive synthetic.mjs)."""
    r = random.Random(seed)
    out = []
    for i in range(n):
        e = edge + drift * math.sin(2 * math.pi * i / 900)
        u = r.random()
        m = max(1.0, math.floor(100 * (1 - e) / max(u, 1e-12)) / 100)
        ts_ms = start_ms + i * step_ms
        out.append({
            "id": i + 1,
            "ts": _iso(ts_ms),
            "tsMs": ts_ms,
            "multiplier": m,
            "color": None,
            "source": source,
            "sessionId": 1 + i // 400,
            "origin": "observed",
        })
    return out


def _iso(ms: int) -> str:
    import datetime as dt
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def rounds_of(t: list[dict]) -> list[Round]:
    return [Round(**d) for d in t]


def ts_call(module: str, calls: list[dict], tapes: dict | None = None) -> list:
    ensure_build()
    req = {"module": module, "calls": calls, "tapes": tapes or {}}
    p = subprocess.run(["node", str(HERE / "run_ts.mjs")], input=json.dumps(req), capture_output=True, text=True, timeout=600)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[-2000:])
    res = json.loads(p.stdout)
    for r in res:
        if not r["ok"]:
            raise RuntimeError("TS error: " + r["error"])
    return [r["value"] for r in res]


def diff(a, b, tol: float = 1e-9, path: str = "$", out: list | None = None, limit: int = 20) -> list[str]:
    """Structural diff of plain JSON values (relative/absolute tolerance on numbers)."""
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    a = to_plain(a)
    if isinstance(a, bool) or isinstance(b, bool):
        if a != b:
            out.append(f"{path}: {a!r} != {b!r}")
        return out
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if not (abs(a - b) <= tol * max(1.0, abs(a), abs(b))):
            out.append(f"{path}: {a!r} != {b!r}")
        return out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(f"{path}.{k}: missing in python (ts={str(b[k])[:60]})")
            elif k not in b:
                out.append(f"{path}.{k}: extra in python ({str(a[k])[:60]})")
            else:
                diff(a[k], b[k], tol, f"{path}.{k}", out, limit)
        return out
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{path}: len {len(a)} != {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, tol, f"{path}[{i}]", out, limit)
        return out
    if a != b:
        out.append(f"{path}: {str(a)[:80]!r} != {str(b)[:80]!r}")
    return out
