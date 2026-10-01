"""
Database watcher for momentoV1 rounds.

Watches the momentoV1 database for new rounds and triggers ingestion
into the new momento_core system.
"""

import sqlite3
import time
import logging
from pathlib import Path
from typing import Optional, Callable, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class DatabaseWatcher:
    """
    Watches momentoV1 database for new rounds.
    
    Monitors the rounds table in the momentoV1 SQLite database and
    triggers callbacks when new rounds are detected.
    """
    
    def __init__(
        self,
        db_path: str,
        poll_interval: float = 1.0,
        source: str = "momentoV1"
    ) -> None:
        """
        Initialize database watcher.
        
        Args:
            db_path: Path to momentoV1 SQLite database
            poll_interval: Polling interval in seconds
            source: Source identifier for the rounds
        """
        self.db_path = Path(db_path)
        self.poll_interval = poll_interval
        self.source = source
        self.last_round_id: Optional[int] = None
        self.is_running = False
        self.callbacks: list[Callable[[Dict[str, Any]], None]] = []
        
        if not self.db_path.exists():
            raise FileNotFoundError(f"Database not found: {db_path}")
    
    def add_callback(self, callback: Callable[[Dict[str, Any]], None]) -> None:
        """
        Add callback function for new rounds.
        
        Args:
            callback: Function to call with new round data
        """
        self.callbacks.append(callback)
    
    def _get_latest_round_id(self) -> Optional[int]:
        """Get the latest round ID from the database."""
        try:
            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()
            cursor.execute("SELECT MAX(id) FROM rounds")
            result = cursor.fetchone()
            conn.close()
            return result[0] if result and result[0] else None
        except sqlite3.Error as e:
            logger.error(f"Error getting latest round ID: {e}")
            return None
    
    def _get_new_rounds(self, since_id: Optional[int]) -> list[Dict[str, Any]]:
        """
        Get new rounds since the last seen ID.
        
        Args:
            since_id: Last seen round ID (None for all rounds)
            
        Returns:
            List of new round dictionaries
        """
        try:
            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()
            
            if since_id is None:
                # Get all rounds initially
                cursor.execute("""
                    SELECT id, timestamp, multiplier, color, source_file, source, created_at
                    FROM rounds
                    ORDER BY id ASC
                """)
            else:
                # Get only new rounds
                cursor.execute("""
                    SELECT id, timestamp, multiplier, color, source_file, source, created_at
                    FROM rounds
                    WHERE id > ?
                    ORDER BY id ASC
                """, (since_id,))
            
            rows = cursor.fetchall()
            conn.close()
            
            return [
                {
                    "id": row[0],
                    "timestamp": row[1],
                    "multiplier": row[2],
                    "color": row[3],
                    "source_file": row[4],
                    "source": row[5],
                    "created_at": row[6]
                }
                for row in rows
            ]
        except sqlite3.Error as e:
            logger.error(f"Error getting new rounds: {e}")
            return []
    
    def _process_new_rounds(self, rounds: list[Dict[str, Any]]) -> None:
        """
        Process new rounds and trigger callbacks.
        
        Args:
            rounds: List of new round dictionaries
        """
        for round_data in rounds:
            logger.info(f"New round detected: ID={round_data['id']}, multiplier={round_data['multiplier']}")
            
            # Update last seen ID
            self.last_round_id = round_data['id']
            
            # Trigger callbacks
            for callback in self.callbacks:
                try:
                    callback(round_data)
                except Exception as e:
                    logger.error(f"Error in callback: {e}")
    
    def start(self) -> None:
        """Start watching the database for new rounds."""
        logger.info(f"Starting database watcher for {self.db_path}")
        
        # Initialize last round ID
        self.last_round_id = self._get_latest_round_id()
        logger.info(f"Initial last round ID: {self.last_round_id}")
        
        self.is_running = True
        
        while self.is_running:
            try:
                # Check for new rounds
                new_rounds = self._get_new_rounds(self.last_round_id)
                
                if new_rounds:
                    self._process_new_rounds(new_rounds)
                
                # Wait before next poll
                time.sleep(self.poll_interval)
                
            except Exception as e:
                logger.error(f"Error in watch loop: {e}")
                time.sleep(self.poll_interval)
    
    def stop(self) -> None:
        """Stop watching the database."""
        logger.info("Stopping database watcher")
        self.is_running = False
