"""Response envelope + request helpers shared by every route module.

Mirrors the archive's `json / ok / fail` helpers: `{ok: true, data}` or
`{ok: false, error}` with the archive's HTTP status codes.
"""

from __future__ import annotations

import math
from typing import Any
from urllib.parse import parse_qsl

INF = float("inf")


class Resp:
    __slots__ = ("body", "status", "headers", "raw", "media_type")

    def __init__(self, body: Any, status: int = 200, headers: dict | None = None, raw: bytes | str | None = None, media_type: str = "application/json"):
        self.body = body
        self.status = status
        self.headers = headers or {}
        self.raw = raw
        self.media_type = media_type


def json_resp(data: Any, status: int = 200) -> Resp:
    return Resp(data, status)


def ok(data: Any) -> Resp:
    return Resp({"ok": True, "data": data}, 200)


def fail(error: str, status: int = 400) -> Resp:
    return Resp({"ok": False, "error": error}, status)


def text_resp(text: str, media_type: str = "text/plain; charset=utf-8", status: int = 200, headers: dict | None = None) -> Resp:
    return Resp(None, status, headers, raw=text, media_type=media_type)


class Query:
    """URLSearchParams subset: get / getAll / has / entries (first value wins)."""

    def __init__(self, qs: str | dict | None = ""):
        if isinstance(qs, dict):
            self._pairs = [(str(k), str(v)) for k, v in qs.items()]
        else:
            self._pairs = parse_qsl(qs or "", keep_blank_values=True)

    def get(self, key: str, default: Any = None) -> str | None:
        for k, v in self._pairs:
            if k == key:
                return v
        return default

    def getAll(self, key: str) -> list[str]:  # noqa: N802
        return [v for k, v in self._pairs if k == key]

    get_all = getAll

    def has(self, key: str) -> bool:
        return any(k == key for k, _ in self._pairs)

    def __contains__(self, key: str) -> bool:
        return self.has(key)

    def entries(self) -> list[tuple[str, str]]:
        return list(self._pairs)

    def keys(self) -> list[str]:
        return list(dict.fromkeys(k for k, _ in self._pairs))

    def to_dict(self) -> dict:
        out: dict = {}
        for k, v in self._pairs:
            out.setdefault(k, v)
        return out

    def __iter__(self):
        return iter(self._pairs)


def js_number(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, (list, dict)):
        if isinstance(v, list) and len(v) == 1:
            return js_number(v[0])
        return 0.0 if v == [] else math.nan
    s = str(v).strip()
    if s == "":
        return 0.0
    low = s.lower()
    if low in ("infinity", "+infinity"):
        return INF
    if low == "-infinity":
        return -INF
    if low in ("inf", "+inf", "-inf", "nan"):
        return math.nan
    try:
        if low.startswith("0x"):
            return float(int(s, 16))
        return float(s)
    except ValueError:
        return math.nan


def num(v: Any, d: float, lo: float = -INF, hi: float = INF) -> float:
    """archive `num`: default on null/undefined/""/non-finite, else clamp."""
    if v is None or v == "":
        return d
    n = js_number(v)
    return min(hi, max(lo, n)) if math.isfinite(n) else d


def inum(v: Any, d: float, lo: float = -INF, hi: float = INF) -> int:
    """num() for values used as integer counts / slice bounds (JS would floor in slice)."""
    x = num(v, d, lo, hi)
    return int(math.trunc(x)) if math.isfinite(x) else int(d)


def truthy(v: Any) -> bool:
    """JS truthiness for parsed JSON values."""
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    if isinstance(v, str):
        return v != ""
    return True


def jstr(v: Any) -> str:
    """String(v) for body values."""
    from momento.jsutil import js_str

    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return js_str(v)
    if isinstance(v, list):
        return ",".join("" if x is None else jstr(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)
