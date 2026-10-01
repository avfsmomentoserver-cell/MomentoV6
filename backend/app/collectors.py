#!/usr/bin/env python3
"""P7 collectors CLI — push rounds to the Momento backend.

A lightweight collector that reads rounds from a file or watches a directory
and posts them to ``POST /api/v1/ingest``.  Replaces the vendored
momento_core collector (which used SQLAlchemy directly) with a simple HTTP
client that talks to the new FastAPI backend.

Usage:
    python -m app.collectors file --source aviator --file rounds.json
    python -m app.collectors watch --source aviator --dir /path/to/inbox
    python -m app.collectors csv --source aviator --file rounds.csv

The file format is one JSON object per line:
    {"multiplier": 2.34, "timestamp": 1700000000}
    {"multiplier": 1.05, "color": "red"}

Or a CSV with columns: multiplier,timestamp,color

Authentication: set MOMENTO_TOKEN or pass --token.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore


DEFAULT_URL = os.environ.get("MOMENTO_API_URL", "http://localhost:8787")


def _client(token: str | None = None) -> "httpx.Client":
    if httpx is None:
        raise RuntimeError("httpx is required: pip install httpx")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.Client(base_url=DEFAULT_URL, headers=headers, timeout=30)


def _ingest(client: "httpx.Client", source: str, rounds: list[dict]) -> dict:
    """Post rounds to /api/v1/ingest.  Returns the response JSON."""
    payload = {"source": source, "method": "collector", "rounds": rounds}
    r = client.post("/api/v1/ingest", json=payload)
    r.raise_for_status()
    return r.json()


def cmd_file(args: argparse.Namespace) -> int:
    """Read rounds from a JSON file and post them."""
    token = args.token or os.environ.get("MOMENTO_TOKEN")
    path = Path(args.file)
    if not path.exists():
        print(f"error: file not found: {path}", file=sys.stderr)
        return 1

    rounds = []
    with open(path) as f:
        if path.suffix == ".csv":
            import csv
            reader = csv.DictReader(f)
            for row in reader:
                m = float(row.get("multiplier", 0))
                if m >= 1.0:
                    r = {"multiplier": m}
                    if "timestamp" in row and row["timestamp"]:
                        r["timestamp"] = int(row["timestamp"])
                    if "color" in row and row["color"]:
                        r["color"] = row["color"]
                    rounds.append(r)
        else:
            # JSON lines or JSON array
            content = f.read().strip()
            if content.startswith("["):
                for item in json.loads(content):
                    rounds.append({"multiplier": float(item.get("multiplier", item) if isinstance(item, (int, float)) else item["multiplier"])})
            else:
                for line in content.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    item = json.loads(line)
                    if "multiplier" in item:
                        rounds.append({"multiplier": float(item["multiplier"]),
                                       **({"timestamp": int(item["timestamp"])} if "timestamp" in item else {}),
                                       **({"color": item["color"]} if "color" in item else {})})

    if not rounds:
        print("error: no valid rounds found in file", file=sys.stderr)
        return 1

    with _client(token) as client:
        batch = args.batch
        total = 0
        for i in range(0, len(rounds), batch):
            chunk = rounds[i:i + batch]
            result = _ingest(client, args.source, chunk)
            inserted = result.get("data", {}).get("inserted", 0)
            total += inserted
            print(f"  batch {i // batch + 1}: inserted={inserted}")

    print(f"done: {total} rounds inserted from {path}")
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    """Watch a directory for new round files and ingest them."""
    token = args.token or os.environ.get("MOMENTO_TOKEN")
    watch_dir = Path(args.dir)
    if not watch_dir.is_dir():
        print(f"error: directory not found: {watch_dir}", file=sys.stderr)
        return 1

    processed = set()
    print(f"watching {watch_dir} for round files (interval={args.interval}s)...")

    with _client(token) as client:
        while True:
            for f in sorted(watch_dir.glob("*.json")) + sorted(watch_dir.glob("*.csv")):
                if f.name in processed:
                    continue
                try:
                    rounds = []
                    if f.suffix == ".csv":
                        import csv
                        with open(f) as cf:
                            reader = csv.DictReader(cf)
                            for row in reader:
                                m = float(row.get("multiplier", 0))
                                if m >= 1.0:
                                    rounds.append({"multiplier": m})
                    else:
                        with open(f) as jf:
                            for line in jf:
                                line = line.strip()
                                if not line:
                                    continue
                                item = json.loads(line)
                                if "multiplier" in item:
                                    rounds.append({"multiplier": float(item["multiplier"])})

                    if rounds:
                        result = _ingest(client, args.source, rounds)
                        inserted = result.get("data", {}).get("inserted", 0)
                        print(f"  {f.name}: inserted={inserted}")
                    processed.add(f.name)

                    # Optionally archive
                    if args.archive:
                        archive_dir = watch_dir / "processed"
                        archive_dir.mkdir(exist_ok=True)
                        f.rename(archive_dir / f.name)
                except Exception as e:
                    print(f"  {f.name}: error: {e}", file=sys.stderr)
                    processed.add(f.name)

            time.sleep(args.interval)


def main() -> int:
    parser = argparse.ArgumentParser(description="Momento collectors CLI")
    parser.add_argument("--url", default=DEFAULT_URL, help="Backend API URL")
    parser.add_argument("--token", default=None, help="Bearer token (or MOMENTO_TOKEN env)")

    sub = parser.add_subparsers(dest="command", required=True)

    file_cmd = sub.add_parser("file", help="Ingest rounds from a file")
    file_cmd.add_argument("--source", required=True, help="Source name")
    file_cmd.add_argument("--file", required=True, help="Path to rounds file (JSON/CSV)")
    file_cmd.add_argument("--batch", type=int, default=500, help="Batch size")

    watch_cmd = sub.add_parser("watch", help="Watch a directory for new round files")
    watch_cmd.add_argument("--source", required=True, help="Source name")
    watch_cmd.add_argument("--dir", required=True, help="Directory to watch")
    watch_cmd.add_argument("--interval", type=int, default=5, help="Poll interval (seconds)")
    watch_cmd.add_argument("--archive", action="store_true", help="Move processed files to subdir")

    args = parser.parse_args()

    if args.url:
        global DEFAULT_URL
        DEFAULT_URL = args.url

    if args.command == "file":
        return cmd_file(args)
    elif args.command == "watch":
        return cmd_watch(args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
