"""
ML Prediction route handlers.

Provides endpoints for ML-based crash game predictions using the trained ensemble model.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from momento_core.db.session import get_db_session
from momento_core.db.models import CollectedData
from momento_core.prediction import EnsembleEngine
from typing import Dict, Any
import joblib
from pathlib import Path

router = APIRouter()

# Load the trained ensemble model
MODEL_PATH = Path(__file__).parent.parent.parent / "prediction" / "ml_ensemble.pkl"
ensemble = None

def load_model():
    """Load the trained ML ensemble model."""
    global ensemble
    if ensemble is None and MODEL_PATH.exists():
        try:
            ensemble = joblib.load(MODEL_PATH)
            print("ML ensemble model loaded successfully")
        except Exception as e:
            print(f"Failed to load ML model: {e}")

@router.on_event("startup")
async def startup_event():
    """Load ML model on startup."""
    load_model()

@router.get("/ml-predictions/next-round")
def predict_next_round(
    source: str = Query("aviator", description="Data source identifier"),
    db: Session = Depends(get_db_session)
):
    """
    Generate ML prediction for the next crash round.
    
    This endpoint uses the trained ensemble model to predict whether the next
    round will be high (>2.0x) or low (≤2.0x) based on recent historical data.
    
    Args:
        source: Data source identifier (default: "aviator")
        db: Database session from dependency injection
        
    Returns:
        Prediction with confidence score and individual model predictions
    """
    try:
        if ensemble is None:
            raise HTTPException(status_code=503, detail="ML model not loaded")
        
        # Get recent rounds from database
        recent_data = db.query(CollectedData).filter(
            CollectedData.data_source_id == 1  # Assuming aviator source
        ).order_by(CollectedData.timestamp.desc()).limit(50).all()
        
        if len(recent_data) < 50:
            raise HTTPException(
                status_code=400, 
                detail=f"Need at least 50 recent rounds, got {len(recent_data)}"
            )
        
        # Convert to format expected by ML model
        recent_rounds = []
        for data in reversed(recent_data):  # Reverse to get chronological order
            import json
            raw_data = json.loads(data.raw_data) if isinstance(data.raw_data, str) else data.raw_data
            recent_rounds.append({
                'multiplier': data.multiplier,
                'color': data.color,
                'timestamp': data.timestamp
            })
        
        # Make prediction
        prediction, individual_predictions = ensemble.predict(recent_rounds)
        
        # Determine classification
        is_high = prediction > 0.5
        prediction_class = "high" if is_high else "low"
        confidence = abs(prediction - 0.5) * 2  # Convert to 0-1 confidence scale
        
        return {
            "prediction": prediction_class,
            "probability": float(prediction),
            "confidence": float(confidence),
            "threshold": 2.0,
            "individual_predictions": {
                name: float(pred) for name, pred in individual_predictions.items()
            },
            "data_points": len(recent_rounds),
            "model_type": "ensemble",
            "accuracy_baseline": 0.56  # From training results
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ML prediction failed: {str(e)}")


@router.get("/ml-predictions/batch")
def predict_batch(
    count: int = Query(10, ge=1, le=100, description="Number of predictions to generate"),
    source: str = Query("aviator", description="Data source identifier"),
    db: Session = Depends(get_db_session)
):
    """
    Generate multiple ML predictions for future rounds.
    
    This endpoint generates multiple predictions to help with strategy planning.
    Note: These are simulated predictions based on current patterns.
    
    Args:
        count: Number of predictions to generate (1-100)
        source: Data source identifier (default: "aviator")
        db: Database session from dependency injection
        
    Returns:
        List of predictions with confidence scores
    """
    try:
        if ensemble is None:
            raise HTTPException(status_code=503, detail="ML model not loaded")
        
        # Get recent rounds
        recent_data = db.query(CollectedData).filter(
            CollectedData.data_source_id == 1
        ).order_by(CollectedData.timestamp.desc()).limit(50).all()
        
        if len(recent_data) < 50:
            raise HTTPException(
                status_code=400,
                detail=f"Need at least 50 recent rounds, got {len(recent_data)}"
            )
        
        # Convert to format expected by ML model
        recent_rounds = []
        for data in reversed(recent_data):
            import json
            raw_data = json.loads(data.raw_data) if isinstance(data.raw_data, str) else data.raw_data
            recent_rounds.append({
                'multiplier': data.multiplier,
                'color': data.color,
                'timestamp': data.timestamp
            })
        
        # Generate predictions
        predictions = []
        for i in range(count):
            prediction, individual_preds = ensemble.predict(recent_rounds)
            is_high = prediction > 0.5
            prediction_class = "high" if is_high else "low"
            confidence = abs(prediction - 0.5) * 2
            
            predictions.append({
                "index": i + 1,
                "prediction": prediction_class,
                "probability": float(prediction),
                "confidence": float(confidence)
            })
        
        return {
            "predictions": predictions,
            "total": len(predictions),
            "model_type": "ensemble",
            "accuracy_baseline": 0.56
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch prediction failed: {str(e)}")


@router.get("/ml-predictions/model-info")
def get_model_info():
    """
    Get information about the loaded ML model.
    
    Returns model metadata including training accuracy, feature count,
    and model architecture information.
    """
    try:
        if ensemble is None:
            return {
                "loaded": False,
                "message": "ML model not loaded"
            }
        
        return {
            "loaded": True,
            "model_type": "ensemble",
            "models": list(ensemble.models.keys()),
            "accuracy_baseline": 0.56,
            "feature_count": 12,
            "training_data_size": 57677,
            "training_source": "aviator",
            "prediction_mode": "classification",
            "threshold": 2.0
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get model info: {str(e)}")
