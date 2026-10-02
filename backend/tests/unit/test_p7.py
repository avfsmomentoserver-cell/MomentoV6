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
    """live_push puts a round event on every connected client's queue."""
    from app.main import hub, live_push
    from app.core import Core
    import tempfile
    from momento.storage import Database

    os.environ["MOMENTO_CANDIDATES"] = "0"
    db = Database(tempfile.mktemp(suffix=".db"))
    core = Core(db)

    # Simulate two connected clients
    import queue
    cid1 = hub._next_id; hub._clients[cid1] = (None, queue.Queue()); hub._next_id += 1
    cid2 = hub._next_id; hub._clients[cid2] = (None, queue.Queue()); hub._next_id += 1

    live_push(core, "round", {"source": "test-src", "inserted": 5, "origin": "observed"})

    # Both clients should receive the message
    for cid in (cid1, cid2):
        try:
            msg = hub.get_message(cid, timeout=1.0)
            assert msg is not None, f"client {cid} got no message"
            assert msg["event"] == "round"
            assert msg["data"]["source"] == "test-src"
            assert msg["data"]["inserted"] == 5
            assert "ts" in msg
        except Exception:
            assert False, f"client {cid} failed to get message"

    # Clean up
    hub.disconnect(cid1)
    hub.disconnect(cid2)


def test_websocket_drain():
    """Per-client queue drain mechanism works correctly."""
    from app.main import hub
    import queue

    # Simulate a connected client
    cid = hub._next_id; hub._clients[cid] = (None, queue.Queue()); hub._next_id += 1

    # Push a message
    hub.push({"event": "round", "data": {"source": "drain-test", "inserted": 7}, "ts": 12345})

    # Drain it
    msg = hub.get_message(cid, timeout=0.5)
    assert msg is not None, "No message drained"
    assert msg["event"] == "round"
    assert msg["data"]["source"] == "drain-test"
    assert msg["data"]["inserted"] == 7
    assert msg["ts"] == 12345

    # Queue should now be empty
    assert hub.get_message(cid, timeout=0.1) is None

    # Clean up
    hub.disconnect(cid)


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
