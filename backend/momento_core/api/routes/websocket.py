"""
WebSocket route handlers.

Provides WebSocket endpoint for real-time updates to the React UI.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
import json
import asyncio

router = APIRouter()

# Store active WebSocket connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    def emit_message(self, message: dict):
        """Schedule a broadcast safely from sync code paths."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast(message))
        except RuntimeError:
            try:
                asyncio.run(self.broadcast(message))
            except RuntimeError:
                pass
    
    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)

        for connection in dead_connections:
            self.disconnect(connection)

manager = ConnectionManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time updates.
    
    The React UI connects to this endpoint to receive:
    - Analysis updates
    - Rounds updates
    - Connection status
    
    Expected message format from UI:
        { "type": "subscribe", "channel": "analysis|rounds" }
        
    Message format to UI:
        { "type": "analysis:update", "payload": {...} }
        { "type": "rounds:update", "payload": {...} }
        { "type": "connection:status", "payload": {...} }
    """
    await manager.connect(websocket)
    
    # Send initial connection status
    await websocket.send_json({
        "type": "connection:status",
        "payload": {"connected": True}
    })
    
    try:
        while True:
            # Receive messages from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Handle client messages
            if message.get("type") == "subscribe":
                channel = message.get("channel")
                # In a real implementation, you'd subscribe to specific channels
                # For now, we'll just acknowledge
                await websocket.send_json({
                    "type": "subscribed",
                    "payload": {"channel": channel}
                })
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        manager.disconnect(websocket)
        print(f"WebSocket error: {e}")
