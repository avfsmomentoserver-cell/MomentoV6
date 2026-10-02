"""P7 unit tests: WebSocket /live and collectors CLI."""

from __future__ import annotations

import os
import tempfile

import pytest


@pytest.fixture
def client():
    os.environ["MOMENTO_DB"] = tempfile.mktemp(suffix=".db")
    os.environ["MOMENTO_SCHEDULER"] = "0"
    os.environ["MOMENTO_CANDIDATES"] = "0"
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        tok = c.post("/api/v1/auth/login", json={"email": "operator@momento.local", "password": "momento"}).json()["data"]["token"]
        c.headers["Authorization"] = "Bearer " + tok
        yield c


def test_websocket_hello(client):
    """WebSocket /live sends a hello message on connect."""
    with client.websocket_connect("/live") as ws:
        msg = ws.receive_text()
        import json
        data = json.loads(msg)
        assert data["event"] == "hello"
        assert "rounds" in data["data"]
        assert "version" in data["data"]


def test_websocket_ping_pong(client):
    """WebSocket /live responds to ping with pong."""
    with client.websocket_connect("/live") as ws:
        import json
        # Consume hello first
        hello = ws.receive_text()
        assert json.loads(hello)["event"] == "hello"
        # Send ping
        ws.send_text("ping")
        msg = ws.receive_text()
        data = json.loads(msg)
        assert data["event"] == "pong"
        assert "ts" in data


def test_collectors_cli_compiles():
    """Collectors CLI module compiles without syntax errors."""
    import py_compile
    py_compile.compile("app/collectors.py", doraise=True)


def test_collectors_cli_help():
    """Collectors CLI --help works."""
    import subprocess, sys
    result = subprocess.run(
        [sys.executable, "-m", "app.collectors", "--help"],
        capture_output=True, text=True, cwd=".",
        env={**os.environ, "PYTHONPATH": "."}
    )
    assert result.returncode == 0
    assert "Momento collectors CLI" in result.stdout
