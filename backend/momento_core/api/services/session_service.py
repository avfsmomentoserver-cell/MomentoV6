"""
Session service for grouping rounds into continuous sessions and producing
session-level summaries suitable for dashboard broadcasting.
"""
from typing import Dict, Any, List
from sqlalchemy.orm import Session
from sqlalchemy import asc
from datetime import datetime
from momento_core.db.models.collected_data import CollectedData


class SessionService:
    """Compute session groupings and summary metrics."""

    def __init__(self, db: Session):
        self.db = db
        self._cached_payload = None
        self._last_broadcast_ts = None

    def _group_into_sessions(self, rows: List[CollectedData], gap_seconds: int = 300):
        sessions: List[List[CollectedData]] = []
        cur: List[CollectedData] = []
        for r in rows:
            if not cur:
                cur.append(r)
                continue
            prev_ts = cur[-1].timestamp
            now_ts = r.timestamp
            prev = prev_ts if isinstance(prev_ts, datetime) else datetime.fromisoformat(prev_ts)
            now = now_ts if isinstance(now_ts, datetime) else datetime.fromisoformat(now_ts)
            if (now - prev).total_seconds() <= gap_seconds:
                cur.append(r)
            else:
                sessions.append(cur)
                cur = [r]
        if cur:
            sessions.append(cur)
        return sessions

    def latest_session_summary(self, source: str = "aviator", gap_seconds: int = 300) -> Dict[str, Any]:
        """Return a summary payload describing the latest continuous session."""
        query = self.db.query(CollectedData).filter(CollectedData.data_source.has(name=source)).order_by(asc(CollectedData.timestamp))
        rows = query.all()
        if not rows:
            return {
                "source": source,
                "active": False,
                "rounds_available": 0,
                "count": 0,
                "avg_round_secs": None,
                "start": None,
                "end": None,
            }

        sessions = self._group_into_sessions(rows, gap_seconds=gap_seconds)
        # pick the newest session by end time
        latest = sessions[-1]
        # compute metrics
        start = latest[0].timestamp
        end = latest[-1].timestamp
        count = len(latest)
        # avg round secs: average difference between adjacent rounds
        if count > 1:
            diffs = []
            for i in range(1, count):
                a = latest[i - 1].timestamp
                b = latest[i].timestamp
                a_dt = a if isinstance(a, datetime) else datetime.fromisoformat(a)
                b_dt = b if isinstance(b, datetime) else datetime.fromisoformat(b)
                diffs.append((b_dt - a_dt).total_seconds())
            avg_round_secs = sum(diffs) / len(diffs)
        else:
            avg_round_secs = None

        return {
            "source": source,
            "active": True,
            "rounds_available": len(rows),
            "count": count,
            "avg_round_secs": avg_round_secs,
            "start": start,
            "end": end,
        }

    def emit_session_update(self, manager, source: str = "aviator", min_interval_ms: int = 500):
        """Compute the latest session payload and emit it via manager, throttled.

        Returns the payload emitted (or cached payload if throttled).
        """
        import time
        now = int(time.time() * 1000)

        payload = self.latest_session_summary(source)

        if self._last_broadcast_ts is not None and (now - self._last_broadcast_ts) < min_interval_ms:
            # Too frequent — return cached payload without broadcasting
            return self._cached_payload or payload

        try:
            manager.emit_message({"type": "session:update", "payload": payload})
            self._cached_payload = payload
            self._last_broadcast_ts = now
        except Exception:
            # Do not fail the caller — log and return payload
            import logging
            logging.getLogger(__name__).exception("Failed to emit session:update")

        return payload


__all__ = ["SessionService"]
