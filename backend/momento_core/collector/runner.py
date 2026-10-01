"""
Main runner for database watcher and ingestion pipeline.

Orchestrates the watching of momentoV1 database and ingestion of
new rounds into momento_core.
"""

import logging
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from momento_core.collector.db_watcher import DatabaseWatcher
from momento_core.collector.ingest_client import IngestClient

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    """Main entry point for the watcher and ingestion pipeline."""
    
    # Configuration
    momentoV1_db_path = "/home/pirates/collectors/Avfs_Core/avfs/database/avfs.db"
    poll_interval = 1.0  # Check every second
    source_name = "momentoV1"
    
    logger.info("Starting momentoV1 → momento_core ingestion pipeline")
    logger.info(f"Watching database: {momentoV1_db_path}")
    
    try:
        # Initialize ingest client
        ingest_client = IngestClient(source_name=source_name)
        logger.info("Ingest client initialized")
        
        # Initialize database watcher
        watcher = DatabaseWatcher(
            db_path=momentoV1_db_path,
            poll_interval=poll_interval,
            source=source_name
        )
        
        # Add callback for new rounds
        def on_new_round(round_data):
            """Callback when new round is detected."""
            logger.info(f"Processing new round: {round_data['id']}")
            
            # Ingest with linguistic analysis
            result = ingest_client.ingest_with_linguistics(round_data)
            
            if result:
                logger.info(f"✓ Round {round_data['id']} ingested successfully")
            else:
                logger.warning(f"✗ Round {round_data['id']} not ingested (may be duplicate)")
        
        watcher.add_callback(on_new_round)
        logger.info("Database watcher configured")
        
        # Start watching
        logger.info("Starting watch loop...")
        watcher.start()
        
    except KeyboardInterrupt:
        logger.info("Received interrupt signal, shutting down...")
        watcher.stop()
        logger.info("Shutdown complete")
        
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
