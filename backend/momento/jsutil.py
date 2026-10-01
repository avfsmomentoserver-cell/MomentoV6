"""JavaScript-compatible numeric helpers.

The domain code is ported from the archived TypeScript backend. These helpers
make the Python output match it exactly where Python and JavaScript differ:

- ``js_round`` — ``Math.round`` (half up toward +inf), not banker's rounding.
- ``js_str`` — ``String(n)`` / template literal (``2`` not ``2.0``; ``1e21``...).
- ``to_fixed`` — ``Number.prototype.toFixed``.
- ``dumps`` — ``JSON.stringify``: NaN / ±Infinity become ``null``; dataclasses
  and objects with ``to_json`` are serialised.
"""

from __future__ import annotations

import dataclasses
import json
import math
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

INF = math.inf


def js_round(x: float) -> float:
    """Math.round: floor(x + 0.5). Returns float to keep arithmetic float-y; ints for display via js_str."""
    if x is None or not math.isfinite(x):
        return x
    return float(math.floor(x + 0.5))


def round_to(x: float, digits: int) -> float:
    """Math.round(x * 10^d) / 10^d — the archive's usual rounding idiom."""
    if x is None or not isinstance(x, (int, float)) or not math.isfinite(x):
        return x
    f = 10 ** digits
    return math.floor(x * f + 0.5) / f


def r2(x: float) -> float:
    return round_to(x, 2)


def r3(x: float) -> float:
    return round_to(x, 3)


def r4(x: float) -> float:
    return round_to(x, 4)


def is_finite(x: Any) -> bool:
    """Number.isFinite: only real numbers that are finite (bools are not numbers in JS)."""
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def num(x: Any, default: float = math.nan) -> float:
    """Number(x): JS coercion for the common cases ('' → 0, None → NaN here so callers can default)."""
    if x is None:
        return default
    if isinstance(x, bool):
        return 1.0 if x else 0.0
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip()
    if s == "":
        return 0.0
    try:
        if s.lower().startswith(("0x", "-0x")):
            return float(int(s, 16))
        return float(s)
    except ValueError:
        return math.nan


def js_str(x: Any) -> str:
    """String(x) for numbers as JavaScript prints them."""
    if isinstance(x, bool):
        return "true" if x else "false"
    if x is None:
        return "null"
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        if math.isnan(x):
            return "NaN"
        if math.isinf(x):
            return "Infinity" if x > 0 else "-Infinity"
        if x == int(x) and abs(x) < 1e21:
            return str(int(x))
        r = repr(x)
        if "e" in r:
            mant, exp = r.split("e")
            e = int(exp)
            if -7 < e < 21:
                return format(Decimal(r), "f")
            return f"{mant}e{'+' if e > 0 else '-'}{abs(e)}"
        return r
    return str(x)


def to_fixed(x: float, digits: int = 0) -> str:
    """Number.prototype.toFixed (half away from zero on the decimal representation)."""
    if x is None:
        return "null"
    if not math.isfinite(x):
        return js_str(x)
    if abs(x) >= 1e21:
        return js_str(x)
    q = Decimal(1).scaleb(-digits)
    # JS uses the exact binary value of the double (3.6575 is 3.65749999… → "3.657")
    d = Decimal(float(x)).quantize(q, rounding=ROUND_HALF_UP)
    s = format(d, "f")
    if s.startswith("-") and float(d) == 0:
        s = s[1:]
    return s


def clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def _clean(o: Any) -> Any:
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items() if v is not _UNDEF}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if dataclasses.is_dataclass(o) and not isinstance(o, type):
        return _clean({f.name: getattr(o, f.name) for f in dataclasses.fields(o) if getattr(o, f.name) is not _UNDEF})
    if hasattr(o, "to_json"):
        return _clean(o.to_json())
    if isinstance(o, set):
        return [_clean(v) for v in o]
    return o


class _Undefined:
    """Marker for JS `undefined` object members (dropped by JSON.stringify)."""

    _inst = None

    def __new__(cls):
        if cls._inst is None:
            cls._inst = super().__new__(cls)
        return cls._inst

    def __bool__(self) -> bool:
        return False

    def __repr__(self) -> str:
        return "undefined"


_UNDEF = _Undefined()
UNDEF = _UNDEF


def dumps(o: Any) -> str:
    """JSON.stringify(o) — compact, NaN/Infinity → null, undefined members dropped."""
    return json.dumps(_clean(o), separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def to_plain(o: Any) -> Any:
    """Plain JSON-compatible structure (what JSON.parse(JSON.stringify(o)) would give)."""
    return _clean(o)


def safe_json(s: Any, default: Any = None) -> Any:
    if s is None:
        return default
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return default


def jsdiv(a: float, b: float) -> float:
    """a / b with JavaScript semantics (x/0 → ±Infinity, 0/0 → NaN)."""
    try:
        return a / b
    except ZeroDivisionError:
        if a == 0 or (isinstance(a, float) and math.isnan(a)):
            return math.nan
        return math.inf if (a > 0) == (math.copysign(1, b) > 0) else -math.inf


def jmin(*xs: float) -> float:
    """Math.min: NaN-propagating; Math.min() = Infinity."""
    if len(xs) == 1 and isinstance(xs[0], (list, tuple)):
        xs = tuple(xs[0])
    out = math.inf
    for x in xs:
        if x is None:
            x = 0.0
        if isinstance(x, float) and math.isnan(x):
            return math.nan
        if x < out:
            out = x
    return out


def jmax(*xs: float) -> float:
    """Math.max: NaN-propagating; Math.max() = -Infinity."""
    if len(xs) == 1 and isinstance(xs[0], (list, tuple)):
        xs = tuple(xs[0])
    out = -math.inf
    for x in xs:
        if x is None:
            x = 0.0
        if isinstance(x, float) and math.isnan(x):
            return math.nan
        if x > out:
            out = x
    return out


def tf(x: float, digits: int) -> float:
    """+x.toFixed(d)."""
    return float(to_fixed(x, digits))


def jround(x: float) -> float:
    """Math.round, NaN/Infinity pass through."""
    if x is None:
        return math.nan
    if not math.isfinite(x):
        return x
    return float(math.floor(x + 0.5))


def jlog(x: float) -> float:
    """Math.log: log(0) = -Infinity, log(<0) = NaN."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return math.nan
    if x == 0:
        return -math.inf
    if x < 0:
        return math.nan
    if math.isinf(x):
        return math.inf
    return math.log(x)


def jexp(x: float) -> float:
    try:
        return math.exp(x)
    except OverflowError:
        return math.inf


def jpow(a: float, b: float) -> float:
    try:
        r = a ** b
        if isinstance(r, complex):
            return math.nan
        return float(r)
    except ZeroDivisionError:
        return math.inf
    except OverflowError:
        return math.inf


def jsqrt(x: float) -> float:
    if x is None or (isinstance(x, float) and math.isnan(x)) or x < 0:
        return math.nan
    return math.sqrt(x)


def int32(x: float) -> int:
    """x | 0."""
    if x is None or not math.isfinite(x):
        return 0
    v = int(x) & 0xFFFFFFFF
    return v - 0x100000000 if v >= 0x80000000 else v


def jsum(xs) -> float:
    """arr.reduce((a, b) => a + b, 0): naive left-to-right float addition.

    Python ≥ 3.12 ``sum()`` uses compensated summation, which differs from
    JavaScript in the last bits — enough to flip a toFixed() tie.
    """
    s = 0
    for x in xs:
        s += x
    return s
