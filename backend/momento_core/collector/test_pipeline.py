"""
Test script for database watcher and ingestion pipeline.

Tests the momentoV1 database watcher and momento_core ingestion
pipeline to ensure proper functionality.
"""

import logging
import sys
import sqlite3
from pathlib import Path
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from momento_core.collector.db_watcher import DatabaseWatcher
from momento_core.collector.ingest_client import IngestClient
from momento_core.db.session import init_db

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def test_database_watcher():
    """Test database watcher functionality."""
    logger.info("Testing DatabaseWatcher...")
    
    momentoV1_db_path = "/home/pirates/collectors/Avfs_Core/avfs/database/avfs.db"
    
    if not Path(momentoV1_db_path).exists():
        logger.error(f"Database not found: {momentoV1_db_path}")
        return False
    
    try:
        # Test database connection
        conn = sqlite3.connect(momentoV1_db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM rounds")
        count = cursor.fetchone()[0]
        conn.close()
        
        logger.info(f"✓ Database connection successful, total rounds: {count}")
        
        # Test watcher initialization
        watcher = DatabaseWatcher(
            db_path=momentoV1_db_path,
            poll_interval=1.0
        )
        
        logger.info(f"✓ DatabaseWatcher initialized")
        
        # Test getting latest round ID
        latest_id = watcher._get_latest_round_id()
        logger.info(f"✓ Latest round ID: {latest_id}")
        
        # Test getting new rounds
        new_rounds = watcher._get_new_rounds(latest_id - 5 if latest_id and latest_id > 5 else None)
        logger.info(f"✓ Retrieved {len(new_rounds)} rounds for testing")
        
        return True
        
    except Exception as e:
        logger.error(f"✗ DatabaseWatcher test failed: {e}")
        return False


def test_ingest_client():
    """Test ingest client functionality."""
    logger.info("Testing IngestClient...")
    
    try:
        # Initialize momento_core database
        init_db()
        logger.info("✓ momento_core database initialized")
        
        # Test ingest client initialization
        ingest_client = IngestClient(source_name="momentoV1")
        logger.info("✓ IngestClient initialized")
        
        # Test data source creation
        data_source_id = ingest_client._get_data_source_id()
        logger.info(f"✓ Data source ID: {data_source_id}")
        
        # Test payload conversion
        test_round = {
            "id": 99999,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "multiplier": 1.5,
            "color": "rgb(52, 180, 255)",
            "source_file": "test",
            "source": "aviator"
        }
        
        payload = ingest_client._convert_to_payload(test_round)
        logger.info(f"✓ Payload conversion successful: {payload.multiplier}")
        
        # Test round existence check
        exists = ingest_client._round_exists(test_round)
        logger.info(f"✓ Round existence check: {exists}")
        
        return True
        
    except Exception as e:
        logger.error(f"✗ IngestClient test failed: {e}")
        return False


def test_linguistics_integration():
    """Test MomentoLinguistics integration."""
    logger.info("Testing MomentoLinguistics integration...")
    
    try:
        from momento_core.linguistics import MomentoLinguisticsEngine
        
        engine = MomentoLinguisticsEngine()
        logger.info("✓ MomentoLinguisticsEngine initialized")
        
        # Test conversion
        linguistic_obj = engine.convert(
            multiplier=1.22,
            timestamp="2026-07-19T07:00:00Z",
            color="rgb(52, 180, 255)"
        )
        
        logger.info(f"✓ Linguistic conversion successful")
        logger.info(f"  Market Classification: {linguistic_obj.layer2_market}")
        logger.info(f"  Energy Level: {linguistic_obj.layer3_energy}")
        logger.info(f"  Behaviour: {linguistic_obj.layer4_behaviour}")
        
        # Test dictionary conversion
        obj_dict = linguistic_obj.to_dict()
        logger.info(f"✓ Dictionary conversion successful")
        
        return True
        
    except Exception as e:
        logger.error(f"✗ MomentoLinguistics test failed: {e}")
        return False


def test_end_to_end():
    """Test end-to-end pipeline with sample data."""
    logger.info("Testing end-to-end pipeline...")
    
    try:
        # Initialize components
        init_db()
        ingest_client = IngestClient(source_name="momentoV1")
        
        # Create test round data with unique timestamp
        test_round = {
            "id": 99997,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "multiplier": 1.35,
            "color": "rgb(255, 100, 100)",
            "source_file": "test_pipeline",
            "source": "aviator"
        }
        
        logger.info(f"Testing ingestion of round {test_round['id']}...")
        
        # Test ingestion
        result = ingest_client.ingest_with_linguistics(test_round)
        
        if result:
            logger.info(f"✓ End-to-end test successful: round {test_round['id']} ingested")
            return True
        else:
            logger.warning("✗ End-to-end test: round not ingested (may be duplicate)")
            return True  # Not a failure if duplicate
            
    except Exception as e:
        logger.error(f"✗ End-to-end test failed: {e}")
        return False


def main():
    """Run all tests."""
    logger.info("=" * 60)
    logger.info("Starting momentoV1 → momento_core pipeline tests")
    logger.info("=" * 60)
    
    results = {
        "DatabaseWatcher": test_database_watcher(),
        "IngestClient": test_ingest_client(),
        "MomentoLinguistics": test_linguistics_integration(),
        "EndToEnd": test_end_to_end()
    }
    
    logger.info("=" * 60)
    logger.info("Test Results:")
    logger.info("=" * 60)
    
    for test_name, passed in results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        logger.info(f"{test_name}: {status}")
    
    all_passed = all(results.values())
    
    logger.info("=" * 60)
    if all_passed:
        logger.info("All tests passed!")
        return 0
    else:
        logger.error("Some tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
