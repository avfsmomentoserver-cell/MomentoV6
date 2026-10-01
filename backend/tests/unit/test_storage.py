import sqlite3

from momento.storage import Database


def test_schema_and_cursor_api(tmp_path):
    db = Database(tmp_path / "m.db")
    names = db.table_names()
    assert len(names) == 44 and "rounds" in names and "jobs" in names and "forecast_store" in names
    cols = [r["name"] for r in db.rows("PRAGMA table_info(rounds)")]
    assert "origin" in cols
    assert "cal_loss" in [r["name"] for r in db.rows("PRAGMA table_info(intel_calibrations)")]
    r = db.exec("INSERT INTO settings (key, value) VALUES (?, ?)", "a", "1")
    assert r.rowsWritten == 1
    assert db.exec("SELECT * FROM settings").toArray() == [{"key": "a", "value": "1"}]
    try:
        with db.transaction():
            db.exec("INSERT INTO settings (key, value) VALUES ('b', '2')")
            raise RuntimeError
    except RuntimeError:
        pass
    assert db.scalar("SELECT COUNT(*) FROM settings") == 1
    with db.transaction():
        with db.transaction():
            db.exec("INSERT INTO settings (key, value) VALUES ('c', '3')")
    assert db.scalar("SELECT COUNT(*) FROM settings") == 2
    db.close()
    Database(tmp_path / "m.db").close()  # re-open is idempotent


def test_legacy_database_is_migrated(tmp_path):
    p = tmp_path / "old.db"
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE rounds (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, ts_ms INTEGER NOT NULL, multiplier REAL NOT NULL, color TEXT, source TEXT NOT NULL, session_id INTEGER, ingest TEXT NOT NULL DEFAULT 'api', created_ms INTEGER NOT NULL)")
    c.execute("INSERT INTO rounds (ts, ts_ms, multiplier, source, created_ms) VALUES ('x', 1, 2.0, 'aviator', 1)")
    c.commit()
    c.close()
    db = Database(p)
    assert db.one("SELECT origin FROM rounds") == {"origin": "observed"}
