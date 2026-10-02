"""Contract test: every endpoint the v6.5 frontend calls (and every route in the
AFRESH_PLAN matrix) is served — no 500s, no "no route" 404s, envelope intact.

The endpoint list is regenerated from the frontend sources on every run, so a
new frontend call without a backend route fails this test.
"""

from __future__ import annotations

import os
import random
import re
import tempfile
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "web-momento" / "src"
PLAN = ROOT / "AFRESH_PLAN.md"

CALL = re.compile(r"api\.(get|post|put|del|live)(?:<[^(]*>)?\(\s*[`\"']([^`\"']+)")
USEV1 = re.compile(r"useV1(?:<[^(]*>)?\(\s*[`\"']([^`\"']+)")
PLAN_ROW = re.compile(r"^\| (GET|POST|PUT|DELETE) \| `([^`]+)`", re.M)

SAMPLE = {
    "encodeURIComponent(key)": "baseline", "key": "baseline", "id": "999999", "r.id": "999999", "j.id": "vocabulary",
    "sel": "1", "encodeURIComponent(n)": "nosuch-source", "slug": "overview", "path": "integrity",
}


def _subst(path: str) -> str:
    path = re.sub(r"\$\{qs\([^}]*\}?\)?\}", "", path)  # ${qs({...})}
    path = re.sub(r"\$\{qs\(.*$", "", path)

    def rep(m):
        return SAMPLE.get(m.group(1).strip(), "1")

    path = re.sub(r"\$\{([^}]+)\}", rep, path)
    path = re.sub(r"\$\{.*$", "", path)  # unterminated expression (string literal inside)
    return path.split("?")[0].rstrip("/")


def frontend_calls() -> set[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    for f in list(WEB.rglob("*.ts")) + list(WEB.rglob("*.tsx")):
        src = f.read_text(errors="ignore")
        for m, p in CALL.findall(src):
            if p.startswith("/api/v1/${path}"):
                continue
            method = {"get": "GET", "live": "GET", "post": "POST", "put": "PUT", "del": "DELETE"}[m]
            out.add((method, _subst(p)))
        for p in USEV1.findall(src):
            out.add(("GET", "/api/v1/" + _subst(p)))
    return {(m, p) for m, p in out if p.startswith("/api/v1/") and len(p) > len("/api/v1/")}


def plan_routes() -> set[tuple[str, str]]:
    out = set()
    if not PLAN.exists():
        return out
    for m, p in PLAN_ROW.findall(PLAN.read_text()):
        p = p.replace("{latest|id}", "latest/explain").replace("{source}", "streaks").replace("{id}", "999999").replace("{engine}", "signals")
        p = p.replace("{slug}", "overview").replace("{file}", "nosuch.zip")
        out.add((m, p))
    return out


# destructive or state-resetting routes run last (and with harmless bodies)
LAST = ("/api/v1/intelligence/recalibrate", "/api/v1/autopilot/reset", "/api/v1/rounds", "/api/v1/sources/")


@pytest.fixture(scope="module")
def client():
    os.environ["MOMENTO_DB"] = tempfile.mktemp(suffix=".db")
    os.environ["MOMENTO_SCHEDULER"] = "0"
    os.environ["MOMENTO_INGEST_INTEL_BUDGET"] = "5"
    os.environ["MOMENTO_CANDIDATES"] = "0"  # candidates tested separately; keep contract tests fast
    from fastapi.testclient import TestClient

    from app.main import app

    rnd = random.Random(7)
    with TestClient(app) as c:
        tok = c.post("/api/v1/auth/login", json={"email": "operator@momento.local", "password": "momento"}).json()["data"]["token"]
        c.headers["Authorization"] = "Bearer " + tok
        base = int(time.time() * 1000) - 1600 * 9000
        rows = [{"ts": base + i * 9000, "multiplier": max(1.0, round(0.97 / (1 - rnd.random()), 2))} for i in range(1600)]
        r = c.post("/api/v1/ingest", json={"source": "aviator", "rounds": rows})
        assert r.status_code == 200 and r.json()["data"]["inserted"] == 1600
        yield c


def test_frontend_list_is_nonempty():
    calls = frontend_calls()
    assert len(calls) > 100, calls


def test_every_route_served(client):
    routes = sorted(frontend_calls() | plan_routes(), key=lambda mp: (any(mp[1].startswith(x) for x in LAST), mp[1], mp[0]))
    failures = []
    for method, path in routes:
        if method == "DELETE" and path == "/api/v1/rounds":
            r = client.request("DELETE", path, json={})
        elif method in ("POST", "PUT"):
            r = client.request(method, path, json={})
        else:
            r = client.request(method, path)
        try:
            body = r.json()
        except ValueError:
            body = None
        if r.status_code >= 500:
            failures.append((method, path, r.status_code, (body or {}).get("error") if isinstance(body, dict) else r.text[:200]))
        elif isinstance(body, dict) and str(body.get("error", "")).startswith("no route"):
            failures.append((method, path, r.status_code, body["error"]))
        elif r.headers.get("content-type", "").startswith("application/json") and not (isinstance(body, dict) and "ok" in body):
            failures.append((method, path, r.status_code, "envelope missing"))
    assert not failures, "\n".join(map(str, failures))


def test_as_of_header(client):
    t = int(time.time() * 1000) - 600 * 9000
    r = client.get(f"/api/v1/integrity/summary?as_of={t}")
    assert r.status_code == 200 and "X-Momento-As-Of" in r.headers
    assert client.get("/api/v1/integrity?as_of=not-a-date").status_code == 400


def test_auth_rules(client):
    from fastapi.testclient import TestClient

    from app.main import app

    anon = TestClient(app)
    assert anon.post("/api/v1/engines", json={"family": "window"}).status_code == 401
    assert client.post("/api/v1/auth/register", json={"email": "a@b.c", "password": "short"}).status_code == 400
    assert client.post("/api/v1/auth/register", json={"email": "a@b.c", "password": "x" * 12, "role": "admin"}).status_code == 403
    assert client.post("/api/v1/auth/register", json={"email": "a@b.c", "password": "x" * 12}).status_code == 200
    for _ in range(5):
        anon.post("/api/v1/auth/login", json={"email": "a@b.c", "password": "wrong-password"})
    assert anon.post("/api/v1/auth/login", json={"email": "a@b.c", "password": "x" * 12}).status_code == 429


HAPPY = [
    ("POST", "/api/v1/workbench/run", {"family": "ewma", "params": {"halfLife": 150}, "n": 100}),
    ("POST", "/api/v1/predictions", {"level": 5, "horizon": 10}),
    ("POST", "/api/v1/decisions", {"target": 2, "stake": 1}),
    ("POST", "/api/v1/simulate", {"strategy": {"cashout": 2, "stake": 1}, "sessions": 5, "paths": 60}),
    ("POST", "/api/v1/alerts/rules", {"field": "streak.below2", "op": ">=", "value": 5}),
    ("POST", "/api/v1/experiments/draft", {"hypothesis": "after 3 rounds below 2x the next round reaches 2x more often"}),
    ("POST", "/api/v1/experiments", {"hypothesis": "after 3 rounds below 2x the next round reaches 2x more often"}),
    ("POST", "/api/v1/knowledge/ask", {"q": "what is the 10x eta"}),
    ("POST", "/api/v1/fair/verify", {"server": "abc", "client": "def", "nonce": 1}),
    ("POST", "/api/v1/forecasts/record", {"threshold": 2, "probability": 0.5}),
    ("POST", "/api/v1/vocabulary", {"token": "low·low", "definition": "two low rounds"}),
    ("POST", "/api/v1/backtest/run", {}),
    ("POST", "/api/v1/accuracy/verify", {}),
    ("PUT", "/api/v1/orchestrator/settings", {"patience": 4}),
    ("PUT", "/api/v1/settings", {"values": {"range_profile": "loose"}}),
    ("POST", "/api/v1/engines", {"family": "window", "params": {"window": 300}}),
    ("POST", "/api/v1/ledger/backfill", {"n": 3}),
    ("GET", "/api/v1/forecast/latest/explain", None),
    ("GET", "/api/v1/ledger/verify", None),
]


@pytest.mark.parametrize("method,path,body", HAPPY)
def test_happy_paths(client, method, path, body):
    r = client.request(method, path, json=body)
    j = r.json()
    assert r.status_code == 200 and j["ok"], (r.status_code, j.get("error"), j.get("data"))
