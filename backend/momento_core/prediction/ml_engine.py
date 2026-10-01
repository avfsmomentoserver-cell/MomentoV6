"""
Machine Learning Prediction Engine for Crash Games

Implements proper ML models using historical data to improve prediction accuracy.
"""

import numpy as np
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, RandomForestClassifier, GradientBoostingClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, accuracy_score, classification_report, confusion_matrix
import joblib
from pathlib import Path


class FeatureEngineer:
    """Extract and engineer features from crash round data."""
    
    def __init__(self, window_size: int = 50):
        self.window_size = window_size
        self.scaler = StandardScaler()
        
    def extract_features(self, rounds: List[Dict[str, Any]]) -> List[Dict[str, float]]:
        """Extract features from historical rounds."""
        if len(rounds) < self.window_size:
            raise ValueError(f"Need at least {self.window_size} rounds")
        
        features = []
        for i in range(self.window_size, len(rounds)):
            window = rounds[i-self.window_size:i]
            current_round = rounds[i]
            feature_dict = self._extract_window_features(window, current_round)
            features.append(feature_dict)
        
        return features
    
    def _extract_window_features(self, window: List[Dict], current_round: Dict) -> Dict[str, float]:
        """Extract features from a window of rounds."""
        multipliers = [float(r['multiplier']) for r in window]
        colors = [r.get('color', '') for r in window]
        
        current_multiplier = float(current_round['multiplier'])
        
        features = {
            'mean_multiplier': np.mean(multipliers),
            'std_multiplier': np.std(multipliers),
            'min_multiplier': np.min(multipliers),
            'max_multiplier': np.max(multipliers),
            'median_multiplier': np.median(multipliers),
            'momentum_5': (multipliers[-1] - multipliers[-5]) / multipliers[-5] if len(multipliers) >= 5 else 0,
            'momentum_10': (multipliers[-1] - multipliers[-10]) / multipliers[-10] if len(multipliers) >= 10 else 0,
            'high_count': sum(1 for m in multipliers if m > 2.0),
            'low_count': sum(1 for m in multipliers if m <= 2.0),
            'high_low_ratio': sum(1 for m in multipliers if m > 2.0) / (sum(1 for m in multipliers if m <= 2.0) + 1),
            'volatility': np.std(multipliers) / (np.mean(multipliers) + 1),
            'purple_count': sum(1 for c in colors if 'purple' in c.lower() or 'rgb(192, 23, 180)' in c),
            'blue_count': sum(1 for c in colors if 'blue' in c.lower() or 'rgb(145, 62, 248)' in c),
            'target': current_multiplier,
            'target_class': 1 if current_multiplier > 2.0 else 0  # Binary classification
        }
        
        return features


class MLPredictionEngine:
    """Machine Learning prediction engine with multiple algorithms."""
    
    def __init__(self, model_type: str = 'random_forest', mode: str = 'regression'):
        self.model_type = model_type
        self.mode = mode  # 'regression' or 'classification'
        self.model = None
        self.feature_engineer = FeatureEngineer()
        self.is_trained = False
        
    def train(self, rounds: List[Dict[str, Any]]) -> Dict[str, float]:
        """Train the ML model on historical data."""
        print(f"Training {self.model_type} model ({self.mode}) on {len(rounds)} rounds...")
        
        features = self.feature_engineer.extract_features(rounds)
        
        # Convert to numpy arrays
        feature_names = [k for k in features[0].keys() if k not in ['target', 'target_class']]
        X = np.array([[f[k] for k in feature_names] for f in features])
        
        if self.mode == 'classification':
            y = np.array([f['target_class'] for f in features])
        else:
            y = np.array([f['target'] for f in features])
        
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        X_train_scaled = self.feature_engineer.scaler.fit_transform(X_train)
        X_test_scaled = self.feature_engineer.scaler.transform(X_test)
        
        self.model = self._create_model()
        self.model.fit(X_train_scaled, y_train)
        
        y_pred = self.model.predict(X_test_scaled)
        metrics = self._calculate_metrics(y_test, y_pred)
        
        if self.mode == 'classification':
            cv_scores = cross_val_score(self.model, X_train_scaled, y_train, cv=5, scoring='accuracy')
        else:
            cv_scores = cross_val_score(self.model, X_train_scaled, y_train, cv=5)
        
        metrics['cv_mean'] = cv_scores.mean()
        metrics['cv_std'] = cv_scores.std()
        
        self.is_trained = True
        self.feature_names = feature_names
        print(f"Training complete. Accuracy: {metrics.get('accuracy', 'N/A')}, MAE: {metrics.get('mae', 'N/A')}, R2: {metrics.get('r2', 'N/A')}")
        
        return metrics
    
    def _create_model(self):
        """Create the ML model based on model_type and mode."""
        if self.mode == 'classification':
            if self.model_type == 'random_forest':
                return RandomForestClassifier(n_estimators=100, max_depth=20, min_samples_split=10, random_state=42, n_jobs=-1)
            elif self.model_type == 'gradient_boosting':
                return GradientBoostingClassifier(n_estimators=100, max_depth=10, learning_rate=0.1, random_state=42)
        else:
            if self.model_type == 'random_forest':
                return RandomForestRegressor(n_estimators=100, max_depth=20, min_samples_split=10, random_state=42, n_jobs=-1)
            elif self.model_type == 'gradient_boosting':
                return GradientBoostingRegressor(n_estimators=100, max_depth=10, learning_rate=0.1, random_state=42)
        
        raise ValueError(f"Unknown model type: {self.model_type}")
    
    def predict(self, recent_rounds: List[Dict[str, Any]]) -> float:
        """Make prediction for next round."""
        if not self.is_trained:
            raise ValueError("Model must be trained before prediction")
        
        if len(recent_rounds) < self.feature_engineer.window_size:
            raise ValueError(f"Need at least {self.feature_engineer.window_size} recent rounds")
        
        features = self.feature_engineer._extract_window_features(
            recent_rounds[-self.feature_engineer.window_size:],
            recent_rounds[-1]
        )
        features.pop('target', None)
        
        # Convert to numpy array using feature names
        X = np.array([[features[k] for k in self.feature_names]])
        X_scaled = self.feature_engineer.scaler.transform(X)
        
        prediction = self.model.predict(X_scaled)[0]
        return max(1.0, prediction)
    
    def _calculate_metrics(self, y_true, y_pred) -> Dict[str, float]:
        """Calculate prediction metrics."""
        if self.mode == 'classification':
            return {
                'accuracy': accuracy_score(y_true, y_pred),
            }
        else:
            return {
                'mae': mean_absolute_error(y_true, y_pred),
                'mse': mean_squared_error(y_true, y_pred),
                'rmse': np.sqrt(mean_squared_error(y_true, y_pred)),
                'r2': r2_score(y_true, y_pred)
            }
    
    def save_model(self, path: str):
        """Save trained model to disk."""
        if not self.is_trained:
            raise ValueError("Model must be trained before saving")
        
        model_data = {
            'model': self.model,
            'scaler': self.feature_engineer.scaler,
            'model_type': self.model_type,
            'window_size': self.feature_engineer.window_size
        }
        
        joblib.dump(model_data, path)
        print(f"Model saved to {path}")
    
    def load_model(self, path: str):
        """Load trained model from disk."""
        model_data = joblib.load(path)
        self.model = model_data['model']
        self.feature_engineer.scaler = model_data['scaler']
        self.model_type = model_data['model_type']
        self.feature_engineer.window_size = model_data['window_size']
        self.is_trained = True
        print(f"Model loaded from {path}")


class EnsembleEngine:
    """Ensemble of multiple ML models for better accuracy."""
    
    def __init__(self):
        self.models = {}
        self.weights = {}
        
    def add_model(self, name: str, model: MLPredictionEngine, weight: float = 1.0):
        """Add a model to the ensemble."""
        self.models[name] = model
        self.weights[name] = weight
        
    def predict(self, recent_rounds: List[Dict[str, Any]]) -> Tuple[float, Dict[str, float]]:
        """Make ensemble prediction."""
        predictions = {}
        
        for name, model in self.models.items():
            try:
                pred = model.predict(recent_rounds)
                predictions[name] = pred
            except Exception as e:
                print(f"Error from {name}: {e}")
                predictions[name] = 0.0
        
        total_weight = sum(self.weights[name] for name in predictions.keys())
        weighted_pred = sum(predictions[name] * self.weights[name] for name in predictions.keys()) / total_weight if total_weight > 0 else 0.0
        
        return max(1.0, weighted_pred), predictions


def train_on_exported_data(export_path: str, model_save_path: str = 'ml_model.pkl'):
    """Train ML model on exported data."""
    import json
    
    print(f"Loading data from {export_path}...")
    with open(export_path) as f:
        data = json.load(f)
    
    rounds = data['tables']['rounds']
    print(f"Loaded {len(rounds)} rounds")
    
    aviator_rounds = [r for r in rounds if r.get('source') == 'aviator']
    print(f"Using {len(aviator_rounds)} aviator rounds for training")
    
    models = {}
    
    # Try classification for better accuracy
    rf_engine = MLPredictionEngine('random_forest', mode='classification')
    rf_metrics = rf_engine.train(aviator_rounds)
    models['random_forest'] = rf_engine
    
    gb_engine = MLPredictionEngine('gradient_boosting', mode='classification')
    gb_metrics = gb_engine.train(aviator_rounds)
    models['gradient_boosting'] = gb_engine
    
    ensemble = EnsembleEngine()
    for name, model in models.items():
        ensemble.add_model(name, model, weight=1.0)
    
    joblib.dump(ensemble, model_save_path)
    print(f"Ensemble saved to {model_save_path}")
    
    return {'random_forest': rf_metrics, 'gradient_boosting': gb_metrics}


if __name__ == '__main__':
    export_path = '/home/pirates/collectors/Avfs_Core/exports/export_20260722_005500/database.json'
    model_save_path = '/home/pirates/Avfs_Core/avfs/tmp/core/momento_core/prediction/ml_ensemble.pkl'
    
    metrics = train_on_exported_data(export_path, model_save_path)
    
    print("\n=== Training Results ===")
    for model_name, model_metrics in metrics.items():
        if model_metrics:
            print(f"\n{model_name}:")
            if 'accuracy' in model_metrics:
                print(f"  Accuracy: {model_metrics['accuracy']:.4f}")
            if 'mae' in model_metrics:
                print(f"  MAE: {model_metrics['mae']:.4f}")
            if 'r2' in model_metrics:
                print(f"  R2: {model_metrics['r2']:.4f}")
            print(f"  CV Mean: {model_metrics['cv_mean']:.4f}")
