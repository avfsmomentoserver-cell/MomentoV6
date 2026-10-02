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


def test_live_push_queue():
    """live_push puts a round event on the message queue."""
    from app.main import hub, live_push
    from app.core import Core
    import tempfile
    from momento.storage import Database

    os.environ["MOMENTO_CANDIDATES"] = "0"
    db = Database(tempfile.mktemp(suffix=".db"))
    core = Core(db)

    # Clear the queue
    while not hub._messages.empty():
        hub._messages.get()

    live_push(core, "round", {"source": "test-src", "inserted": 5, "origin": "observed"})

    import queue
    try:
        msg = hub._messages.get(timeout=1.0)
        assert msg["event"] == "round"
        assert msg["data"]["source"] == "test-src"
        assert msg["data"]["inserted"] == 5
        assert "ts" in msg
    except queue.Empty:
        assert False, "No message on queue after live_push"


def test_websocket_drain():
    """WebSocket handler's drain method sends queued messages to clients."""
    import json, asyncio
    from app.main import hub

    # Push a message to the queue
    hub.push({"event": "round", "data": {"source": "drain-test", "inserted": 7}, "ts": 12345})

    # Verify the message is on the queue
    assert not hub._messages.empty()

    # Drain it (simulates what the WebSocket handler does)
    msg = hub._messages.get_nowait()
    assert msg["event"] == "round"
    assert msg["data"]["source"] == "drain-test"
    assert msg["data"]["inserted"] == 7
    assert msg["ts"] == 12345

    # Queue should now be empty
    assert hub._messages.empty()


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
