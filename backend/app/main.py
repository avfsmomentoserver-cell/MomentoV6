"""FastAPI entrypoint — replaces the archive's Worker (index.ts) + Durable Object fetch.

Run:  uvicorn app.main:app --host 0.0.0.0 --port 8787   (from backend/)

* One `Core` per process; every request runs under `core.lock` in a worker
  thread (the DO handled one request at a time — same guarantee here).
* CORS matches index.ts, including the signed-ingest headers and the
  `CORS_ORIGINS` allow-list (Platform Book S-8).
* A background scheduler stands in for the Durable alarm: it fires
  `core.alarm()` when `core.alarm_at_ms` is due and drains bounded
  full-intelligence calibration so ingest/boot never block for long.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketState

from momento.clock import now_ms
from momento.jsutil import dumps
from momento.storage import Database

from .core import Core
from .http import Query, Resp
from .routes import dispatch

log = logging.getLogger("momento.main")

BASE_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Momento-Ts, X-Momento-Nonce, X-Momento-Signature",
    "Access-Control-Expose-Headers": "X-Momento-As-Of",
    "Access-Control-Max-Age": "86400",
}


def cors_for(origin: str | None) -> dict:
    allow = [s.strip() for s in (os.environ.get("CORS_ORIGINS") or "").split(",") if s.strip()]
    if not allow or "*" in allow:
        return dict(BASE_CORS)
    return {**BASE_CORS, "Access-Control-Allow-Origin": origin if origin in allow else allow[0], "Vary": "Origin"}


class State:
    core: Core | None = None
    stop = threading.Event()
    thread: threading.Thread | None = None
    loop = None  # set during lifespan startup


def db_path() -> str:
    p = os.environ.get("MOMENTO_DB") or str(Path(__file__).resolve().parent.parent / "data" / "momento.db")
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    return p


def scheduler_loop(core: Core, stop: threading.Event) -> None:
    """Durable-alarm stand-in + bounded background calibration drain."""
    tick_s = float(os.environ.get("MOMENTO_TICK_SECONDS") or 10)
    budget = int(os.environ.get("MOMENTO_INTEL_DRAIN") or 40)
    while not stop.wait(tick_s):
        try:
            with core.lock:
                core.calibrate_new_rounds(max_intel=budget)
                if now_ms() >= core.alarm_at_ms:
                    core.alarm()
        except Exception:  # noqa: BLE001 — the scheduler must never die
            log.exception("scheduler tick failed")


def build_core() -> Core:
    t0 = time.time()
    # boot without the (potentially long) intel backtest; the scheduler drains it
    core = Core(Database(db_path()), calibrate_on_boot=False)
    core.ingest_intel_budget = int(os.environ.get("MOMENTO_INGEST_INTEL_BUDGET") or 10)
    # P7: wire WebSocket /live push via ingest_listeners (avoids circular import)
    def _live_push(source, inserted, origin):
        try:
            live_push(core, "round", {"source": source, "inserted": inserted, "origin": origin})
        except Exception:
            pass
    core.ingest_listeners.append(_live_push)
    log.info("momento core ready in %.2fs (db=%s)", time.time() - t0, db_path())
    return core


@asynccontextmanager
async def lifespan(_app: FastAPI):
    import asyncio
    State.loop = asyncio.get_event_loop()
    State.core = build_core()
    if os.environ.get("MOMENTO_SCHEDULER", "1") != "0":
        State.stop.clear()
        State.thread = threading.Thread(target=scheduler_loop, args=(State.core, State.stop), daemon=True, name="momento-scheduler")
        State.thread.start()
    yield
    State.stop.set()


app = FastAPI(title="Momento backend", version="6.5.0", lifespan=lifespan, docs_url="/_docs", redoc_url=None, openapi_url="/_openapi.json")


# ------------------------------------------------------------ P7: WebSocket /live
# Ch 16 protocol: a thin push channel that sends the same payload the polling
# endpoints return, so the frontend can optionally switch from polling to push
# without changing any data shapes.  Does not break polling — the frontend
# polls by default and only upgrades to WebSocket if it connects to /live.


class LiveHub:
    """Tracks connected WebSocket clients and broadcasts live updates.

    Uses per-client queues so one client consuming a message does not deprive
    others.  The ingest thread (in a thread pool) pushes to every client's
    queue (thread-safe, non-blocking).
    """

    def __init__(self):
        import queue
        self._clients: dict[int, tuple[WebSocket, queue.Queue]] = {}
        self._next_id = 0

    async def connect(self, ws: WebSocket) -> int:
        await ws.accept()
        import queue
        cid = self._next_id
        self._next_id += 1
        self._clients[cid] = (ws, queue.Queue())
        log.info("live client %d connected (%d total)", cid, len(self._clients))
        return cid

    def disconnect(self, cid: int) -> None:
        if cid in self._clients:
            del self._clients[cid]
        log.info("live client %d disconnected (%d total)", cid, len(self._clients))

    def push(self, message: dict) -> None:
        """Push a message to every client's queue (thread-safe, non-blocking)."""
        for cid, (ws, q) in self._clients.items():
            try:
                q.put_nowait(message)
            except Exception:
                pass  # queue full — drop message for this client

    def get_message(self, cid: int, timeout: float = 0.1):
        """Get a message from a specific client's queue (thread-safe)."""
        if cid not in self._clients:
            return None
        import queue
        try:
            return self._clients[cid][1].get(timeout=timeout)
        except queue.Empty:
            return None

    async def broadcast(self, message: dict) -> None:
        """Send a message to all connected clients.  Non-fatal on failure."""
        import json as _json
        payload = _json.dumps(message, default=str)
        dead = []
        for cid, (ws, q) in self._clients.items():
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_text(payload)
            except Exception:
                dead.append(cid)
        for cid in dead:
            self.disconnect(cid)


hub = LiveHub()


def live_push(core: Core, event: str, data: dict) -> None:
    """Called from the ingest path (thread pool) to push updates to WebSocket clients.

    Pushes to the message queue (thread-safe, non-blocking).  The WebSocket
    handler drains the queue on each receive cycle.
    """
    try:
        msg = {"event": event, "data": data, "ts": now_ms()}
        hub.push(msg)
    except Exception:
        pass  # never block on push failures


@app.websocket("/live")
async def live_ws(ws: WebSocket) -> None:
    """WebSocket /live — optional push channel (Ch 16 protocol).

    On connect, sends an initial ``hello`` with the current state.
    Subsequently pushes ``round`` events on ingest (source, inserted count).
    Responds to ``ping`` with ``pong``.
    """
    cid = await hub.connect(ws)
    try:
        # Send initial state
        core = State.core
        if core:
            rounds = core.rounds_for(None)
            hello = {
                "event": "hello",
                "data": {
                    "rounds": len(rounds),
                    "sources": [s["name"] for s in core.sql.rows("SELECT name FROM sources ORDER BY name")],
                    "version": "6.5.0",
                },
                "ts": now_ms(),
            }
            import json as _json
            await ws.send_text(_json.dumps(hello, default=str))
        # Keep connection alive; drain per-client queue and handle ping/pong
        while True:
            # Check for pushed messages (non-blocking)
            msg = hub.get_message(cid, timeout=0.0)
            if msg is not None:
                import json as _json
                await ws.send_text(_json.dumps(msg, default=str))
            # Wait for client messages (ping/pong) with a short timeout
            try:
                client_msg = await asyncio.wait_for(ws.receive_text(), timeout=0.1)
                if client_msg == "ping":
                    import json as _json
                    await ws.send_text(_json.dumps({"event": "pong", "ts": now_ms()}))
            except asyncio.TimeoutError:
                continue  # no client message; loop and check for pushed messages
    except WebSocketDisconnect:
        hub.disconnect(cid)
    except Exception:
        hub.disconnect(cid)


def to_response(res: Resp, cors: dict) -> Response:
    headers = {**res.headers, **cors}
    if res.raw is not None:
        content = res.raw.encode() if isinstance(res.raw, str) else res.raw
        return Response(content=content, status_code=res.status, headers=headers, media_type=res.media_type)
    return Response(content=dumps(res.body), status_code=res.status, headers=headers, media_type="application/json")


def handle_sync(core: Core, method: str, path: str, qs: str, headers: dict, raw: bytes) -> Resp:
    with core.lock:
        return dispatch(core, method, path, Query(qs), headers, raw)


@app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def catch_all(full_path: str, request: Request) -> Response:
    cors = cors_for(request.headers.get("origin"))
    if request.method == "OPTIONS":
        return Response(status_code=204, headers=cors)
    core = State.core
    if core is None:  # pragma: no cover
        return Response(content=dumps({"ok": False, "error": "booting"}), status_code=503, headers=cors, media_type="application/json")
    raw = await request.body() if request.method in ("POST", "PUT") else b""
    headers = {k.lower(): v for k, v in request.headers.items()}
    res = await run_in_threadpool(handle_sync, core, request.method, "/" + full_path, request.url.query, headers, raw)
    return to_response(res, cors)
