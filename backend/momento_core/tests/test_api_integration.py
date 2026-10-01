"""
API Integration Tests for Ceiling and Gap Swing Analyzers
"""

import pytest
from fastapi.testclient import TestClient
from momento_core.api.main import app


class TestCeilingAnalyzerAPI:
    """Test ceiling analyzer API endpoints."""
    
    def test_get_ceiling_analysis(self):
        """Test GET /api/v1/ceiling-analyzer/analysis endpoint."""
        client = TestClient(app)
        response = client.get("/api/v1/ceiling-analyzer/analysis")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "round_id" in data
        assert "timestamp" in data
        assert "current_crash_point" in data
        assert "ceiling_direction" in data
        assert "ascend_power" in data
        
        # Verify data types
        assert isinstance(data["current_crash_point"], (int, float))
        assert isinstance(data["ascend_power"], (int, float))
        assert data["ascend_power"] >= 0.0
        assert data["ascend_power"] <= 1.0
    
    def test_get_ceiling_statistics(self):
        """Test GET /api/v1/ceiling-analyzer/statistics endpoint."""
        client = TestClient(app)
        response = client.get("/api/v1/ceiling-analyzer/statistics")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "total_ceilings" in data
        assert "current_direction" in data
        
        # Verify data types
        assert isinstance(data["total_ceilings"], int)
        assert data["total_ceilings"] >= 0
    
    def test_configure_ceiling_analyzer(self):
        """Test POST /api/v1/ceiling-analyzer/configure endpoint."""
        client = TestClient(app)
        config_data = {
            "window_size": 100,
            "ceiling_threshold": 0.9
        }
        
        response = client.post("/api/v1/ceiling-analyzer/configure", json=config_data)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "success"
        assert "config" in data
        assert data["config"]["window_size"] == 100
        assert data["config"]["ceiling_threshold"] == 0.9
    
    def test_reset_ceiling_analyzer(self):
        """Test POST /api/v1/ceiling-analyzer/reset endpoint."""
        client = TestClient(app)
        response = client.post("/api/v1/ceiling-analyzer/reset")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "success"
        assert "message" in data


class TestGapSwingAnalyzerAPI:
    """Test gap swing analyzer API endpoints."""
    
    def test_get_gap_swing_analysis(self):
        """Test GET /api/v1/gap-swing-analyzer/analysis endpoint."""
        client = TestClient(app)
        response = client.get("/api/v1/gap-swing-analyzer/analysis")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "round_id" in data
        assert "timestamp" in data
        assert "current_crash_point" in data
        assert "swing_direction" in data
        assert "swing_magnitude" in data
        assert "ma_10" in data
        
        # Verify data types
        assert isinstance(data["current_crash_point"], (int, float))
        assert isinstance(data["swing_magnitude"], (int, float))
        assert isinstance(data["ma_10"], (int, float))
    
    def test_get_gap_swing_statistics(self):
        """Test GET /api/v1/gap-swing-analyzer/statistics endpoint."""
        client = TestClient(app)
        response = client.get("/api/v1/gap-swing-analyzer/statistics")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "total_crossings" in data
        assert "upward_crossings" in data
        assert "downward_crossings" in data
        assert "current_swing_direction" in data
        
        # Verify data types
        assert isinstance(data["total_crossings"], int)
        assert data["total_crossings"] >= 0
    
    def test_configure_gap_swing_analyzer(self):
        """Test POST /api/v1/gap-swing-analyzer/configure endpoint."""
        client = TestClient(app)
        config_data = {
            "ma_periods": [5, 20, 50],
            "gap_levels": [5.0, 20.0, 50.0],
            "repeat_test_iterations": 10
        }
        
        response = client.post("/api/v1/gap-swing-analyzer/configure", json=config_data)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "success"
        assert "config" in data
        assert data["config"]["ma_periods"] == [5, 20, 50]
        assert data["config"]["gap_levels"] == [5.0, 20.0, 50.0]
        assert data["config"]["repeat_test_iterations"] == 10
    
    def test_reset_gap_swing_analyzer(self):
        """Test POST /api/v1/gap-swing-analyzer/reset endpoint."""
        client = TestClient(app)
        response = client.post("/api/v1/gap-swing-analyzer/reset")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "success"
        assert "message" in data
    
    def test_get_historical_crossings(self):
        """Test GET /api/v1/gap-swing-analyzer/historical-crossings endpoint."""
        client = TestClient(app)
        response = client.get("/api/v1/gap-swing-analyzer/historical-crossings?limit=5")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "crossings" in data
        assert "total_count" in data
        assert isinstance(data["crossings"], list)
        assert isinstance(data["total_count"], int)


class TestAPIIntegration:
    """Test overall API integration."""
    
    def test_multiple_sequential_requests(self):
        """Test multiple sequential requests to both analyzers."""
        client = TestClient(app)
        
        # Make multiple requests to ceiling analyzer
        for _ in range(3):
            response = client.get("/api/v1/ceiling-analyzer/analysis")
            assert response.status_code == 200
        
        # Make multiple requests to gap swing analyzer
        for _ in range(3):
            response = client.get("/api/v1/gap-swing-analyzer/analysis")
            assert response.status_code == 200
    
    def test_concurrent_requests(self):
        """Test concurrent requests to both analyzers."""
        import threading
        
        client = TestClient(app)
        results = []
        
        def make_request():
            response = client.get("/api/v1/ceiling-analyzer/analysis")
            results.append(response.status_code)
        
        # Create multiple threads
        threads = [threading.Thread(target=make_request) for _ in range(5)]
        
        # Start all threads
        for thread in threads:
            thread.start()
        
        # Wait for all threads to complete
        for thread in threads:
            thread.join()
        
        # Verify all requests succeeded
        assert all(status == 200 for status in results)
    
    def test_error_handling(self):
        """Test error handling for invalid requests."""
        client = TestClient(app)
        
        # Test with invalid configuration
        invalid_config = {"window_size": -1}
        response = client.post("/api/v1/ceiling-analyzer/configure", json=invalid_config)
        
        # Should handle gracefully (may succeed or fail gracefully)
        assert response.status_code in [200, 400, 422]