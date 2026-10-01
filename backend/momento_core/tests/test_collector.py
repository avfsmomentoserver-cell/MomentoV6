import json
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import momento_core.db.session as db_session_module
from momento_core.db.base import Base
from momento_core.db.models.collected_data import CollectedData
from momento_core.db.models.data_source import DataSource
from momento_core.collector.db_watcher import DatabaseWatcher
from momento_core.collector.ingest_client import IngestClient


@pytest.fixture(autouse=True)
def in_memory_db(monkeypatch):
    """Use an in-memory SQLite database for collector tests."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    monkeypatch.setattr(db_session_module, "engine", engine)
    monkeypatch.setattr(db_session_module, "SessionLocal", SessionLocal)

    yield


class TestIngestClient:
    """Tests for the collector ingest client."""

    def test_ingest_client_creates_data_source_and_ingests_round(self) -> None:
        ingest_client = IngestClient(source_name="collector_game_test")

        round_data = {
            "id": 12345,
            "timestamp": "2026-07-19T07:00:00Z",
            "multiplier": 1.35,
            "color": "rgb(52, 180, 255)",
            "source": "aviator"
        }

        result = ingest_client.ingest_round(round_data)

        assert result is not None
        assert result.multiplier == 1.35
        assert result.color == "rgb(52, 180, 255)"
        assert result.processed is False
        assert result.data_source.name == "collector_game_test"

    def test_ingest_client_skips_duplicate_rounds(self) -> None:
        ingest_client = IngestClient(source_name="collector_game_test")

        round_data = {
            "id": 12346,
            "timestamp": "2026-07-19T07:00:01Z",
            "multiplier": 1.40,
            "color": "rgb(52, 180, 255)",
            "source": "aviator"
        }

        first = ingest_client.ingest_round(round_data)
        second = ingest_client.ingest_round(round_data)

        assert first is not None
        assert second is None

    def test_ingest_with_linguistics_stores_linguistic_payload(self) -> None:
        ingest_client = IngestClient(source_name="collector_game_test")

        round_data = {
            "id": 12347,
            "timestamp": "2026-07-19T07:00:02Z",
            "multiplier": 1.50,
            "color": "rgb(52, 180, 255)",
            "source": "aviator"
        }

        result = ingest_client.ingest_with_linguistics(round_data)

        assert result is not None
        raw_data = json.loads(result.raw_data)
        assert "linguistics" in raw_data
        assert raw_data["linguistics"]["multiplier"] == 1.5
        assert raw_data["source"] == "aviator"

    def test_ingest_with_linguistics_skips_duplicate_on_timestamp_and_multiplier(self) -> None:
        ingest_client = IngestClient(source_name="collector_game_test")

        round_data = {
            "id": 12348,
            "timestamp": "2026-07-19T07:00:03Z",
            "multiplier": 1.55,
            "color": "rgb(52, 180, 255)",
            "source": "aviator"
        }

        first = ingest_client.ingest_with_linguistics(round_data)
        second = ingest_client.ingest_with_linguistics(round_data)

        assert first is not None
        assert second is None


class TestDatabaseWatcher:
    """Tests for the momentoV1 database watcher."""

    def test_database_watcher_reads_rounds_and_triggers_callbacks(self) -> None:
        with TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "momentoV1.db"
            connection = sqlite3.connect(db_path)
            cursor = connection.cursor()
            cursor.execute(
                """
                CREATE TABLE rounds (
                    id INTEGER PRIMARY KEY,
                    timestamp TEXT,
                    multiplier REAL,
                    color TEXT,
                    source_file TEXT,
                    source TEXT,
                    created_at TEXT
                )
                """
            )
            cursor.executemany(
                "INSERT INTO rounds (timestamp, multiplier, color, source_file, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    ("2026-07-19T07:00:00Z", 1.22, "rgb(52, 180, 255)", "test", "aviator", "2026-07-19T07:00:00Z"),
                    ("2026-07-19T07:00:05Z", 1.35, "rgb(255, 100, 100)", "test", "aviator", "2026-07-19T07:00:05Z"),
                ]
            )
            connection.commit()
            connection.close()

            watcher = DatabaseWatcher(db_path=str(db_path), poll_interval=0.01)

            assert watcher._get_latest_round_id() == 2

            all_rounds = watcher._get_new_rounds(None)
            assert len(all_rounds) == 2
            assert all_rounds[0]["multiplier"] == 1.22
            assert all_rounds[1]["multiplier"] == 1.35

            new_rounds = watcher._get_new_rounds(1)
            assert len(new_rounds) == 1
            assert new_rounds[0]["id"] == 2

            captured = []

            def callback(payload):
                captured.append(payload)

            watcher.add_callback(callback)
            watcher._process_new_rounds(new_rounds)

            assert watcher.last_round_id == 2
            assert captured == [new_rounds[0]]
