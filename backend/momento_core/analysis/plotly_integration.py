"""
Plotly Integration for Momento Visualization

Provides Plotly-based visualization components for crash game data including:
- Candlestick charts with OHLC data
- Streak markers overlay
- Regime indicator background zones
- Combined score overlay
- Hybrid scaling integration with MomentoScaler
"""

import plotly.graph_objects as go
from plotly.subplots import make_subplots
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import pandas as pd

from momento_core.analysis.momento_scaler import MomentoScaler


class PlotlyVisualizer:
    """
    Plotly-based visualization for crash game data with advanced features.
    """
    
    def __init__(self, threshold: float = 5.0):
        """
        Initialize the PlotlyVisualizer.
        
        Args:
            threshold: Threshold for hybrid scaling (default: 5.0)
        """
        self.scaler = MomentoScaler(threshold=threshold)
        self.colors = {
            'green': '#22c55e',
            'red': '#ef4444',
            'gold': '#f59e0b',
            'purple': '#8b5cf6',
            'blue': '#38bdf8',
            'background': '#05060a',
            'panel': '#0e111a',
            'border': '#161b28',
            'text': '#eef1fb',
            'muted': '#8b95b7'
        }
    
    def create_candlestick_chart(
        self,
        rounds_data: List[Dict[str, Any]],
        title: str = "Crash Game Analysis",
        show_streaks: bool = True,
        show_regime_zones: bool = True
    ) -> go.Figure:
        """
        Create a candlestick chart with optional streak markers and regime zones.
        
        Args:
            rounds_data: List of round data with multiplier, color, timestamp
            title: Chart title
            show_streaks: Whether to show streak markers
            show_regime_zones: Whether to show regime background zones
            
        Returns:
            Plotly Figure object
        """
        # Convert to DataFrame for easier manipulation
        df = pd.DataFrame(rounds_data)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.sort_values('timestamp')
        
        # Create OHLC data (simplified - using multiplier as close, open as previous)
        df['open'] = df['multiplier'].shift(1).fillna(df['multiplier'].iloc[0])
        df['high'] = df[['multiplier', 'open']].max(axis=1)
        df['low'] = df[['multiplier', 'open']].min(axis=1)
        df['close'] = df['multiplier']
        
        # Create figure
        fig = go.Figure()
        
        # Add regime zones if requested
        if show_regime_zones:
            self._add_regime_zones(fig, df)
        
        # Add candlestick chart
        fig.add_trace(go.Candlestick(
            x=df['timestamp'],
            open=df['open'],
            high=df['high'],
            low=df['low'],
            close=df['close'],
            name='Rounds',
            increasing_line_color=self.colors['green'],
            decreasing_line_color=self.colors['red'],
            increasing_fill_color=self.colors['green'],
            decreasing_fill_color=self.colors['red']
        ))
        
        # Add streak markers if requested
        if show_streaks:
            self._add_streak_markers(fig, df)
        
        # Update layout
        fig.update_layout(
            title=title,
            xaxis_title='Time',
            yaxis_title='Multiplier',
            template='plotly_dark',
            plot_bgcolor=self.colors['background'],
            paper_bgcolor=self.colors['panel'],
            font_color=self.colors['text'],
            xaxis=dict(
                gridcolor=self.colors['border'],
                showgrid=True
            ),
            yaxis=dict(
                gridcolor=self.colors['border'],
                showgrid=True,
                type='log'  # Use logarithmic scale for better visualization
            ),
            height=600,
            margin=dict(l=60, r=30, t=60, b=60)
        )
        
        return fig
    
    def create_scaled_chart(
        self,
        rounds_data: List[Dict[str, Any]],
        title: str = "Scaled Multiplier Chart",
        show_bands: bool = True
    ) -> go.Figure:
        """
        Create a chart using MomentoScaler hybrid scaling.
        
        Args:
            rounds_data: List of round data with multiplier, color, timestamp
            title: Chart title
            show_bands: Whether to show band boundaries
            
        Returns:
            Plotly Figure object
        """
        # Convert to DataFrame
        df = pd.DataFrame(rounds_data)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.sort_values('timestamp')
        
        # Apply scaling
        multipliers = df['multiplier'].values
        scaled_multipliers = self.scaler.scale(multipliers)
        
        # Create figure
        fig = go.Figure()
        
        # Add scatter plot with scaled values
        colors = [self.colors['green'] if color == 'green' else self.colors['red'] 
                 for color in df['color']]
        
        fig.add_trace(go.Scatter(
            x=df['timestamp'],
            y=scaled_multipliers,
            mode='lines+markers',
            name='Scaled Multipliers',
            marker=dict(color=colors, size=6),
            line=dict(color=self.colors['muted'], width=1)
        ))
        
        # Add band boundaries if requested
        if show_bands:
            self._add_band_boundaries(fig, df)
        
        # Update layout
        fig.update_layout(
            title=title,
            xaxis_title='Time',
            yaxis_title='Scaled Multiplier',
            template='plotly_dark',
            plot_bgcolor=self.colors['background'],
            paper_bgcolor=self.colors['panel'],
            font_color=self.colors['text'],
            xaxis=dict(
                gridcolor=self.colors['border'],
                showgrid=True
            ),
            yaxis=dict(
                gridcolor=self.colors['border'],
                showgrid=True
            ),
            height=600,
            margin=dict(l=60, r=30, t=60, b=60)
        )
        
        return fig
    
    def create_combined_score_chart(
        self,
        rounds_data: List[Dict[str, Any]],
        scores: List[float],
        title: str = "Combined Score Analysis"
    ) -> go.Figure:
        """
        Create a chart showing multipliers with combined score overlay.
        
        Args:
            rounds_data: List of round data with multiplier, color, timestamp
            scores: List of combined scores (0.0-1.0) for each round
            title: Chart title
            
        Returns:
            Plotly Figure object
        """
        # Convert to DataFrame
        df = pd.DataFrame(rounds_data)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.sort_values('timestamp')
        df['score'] = scores
        
        # Create subplots
        fig = make_subplots(
            rows=2, cols=1,
            shared_xaxes=True,
            vertical_spacing=0.05,
            row_heights=[0.7, 0.3],
            subplot_titles=('Multipliers', 'Combined Score')
        )
        
        # Add multiplier chart
        colors = [self.colors['green'] if color == 'green' else self.colors['red'] 
                 for color in df['color']]
        
        fig.add_trace(go.Scatter(
            x=df['timestamp'],
            y=df['multiplier'],
            mode='lines+markers',
            name='Multiplier',
            marker=dict(color=colors, size=6),
            line=dict(color=self.colors['muted'], width=1),
            showlegend=False
        ), row=1, col=1)
        
        # Add score chart
        fig.add_trace(go.Scatter(
            x=df['timestamp'],
            y=df['score'],
            mode='lines',
            name='Combined Score',
            line=dict(color=self.colors['purple'], width=2),
            fill='tozeroy',
            fillcolor='rgba(139, 92, 246, 0.2)',
            showlegend=False
        ), row=2, col=1)
        
        # Update layout
        fig.update_layout(
            title=title,
            template='plotly_dark',
            plot_bgcolor=self.colors['background'],
            paper_bgcolor=self.colors['panel'],
            font_color=self.colors['text'],
            height=700,
            margin=dict(l=60, r=30, t=60, b=60)
        )
        
        fig.update_xaxes(gridcolor=self.colors['border'], showgrid=True)
        fig.update_yaxes(gridcolor=self.colors['border'], showgrid=True)
        fig.update_yaxes(type='log', row=1, col=1)  # Log scale for multipliers
        
        return fig
    
    def _add_regime_zones(self, fig: go.Figure, df: pd.DataFrame):
        """Add background zones indicating different regimes."""
        # Simple regime detection based on multiplier distribution
        mean_multiplier = df['multiplier'].mean()
        std_multiplier = df['multiplier'].std()
        
        # Define regime zones
        regimes = [
            {'name': 'Low Volatility', 'min': 0, 'max': mean_multiplier - std_multiplier, 'color': 'rgba(34, 197, 94, 0.1)'},
            {'name': 'Normal', 'min': mean_multiplier - std_multiplier, 'max': mean_multiplier + std_multiplier, 'color': 'rgba(56, 189, 248, 0.1)'},
            {'name': 'High Volatility', 'min': mean_multiplier + std_multiplier, 'max': df['multiplier'].max() * 1.1, 'color': 'rgba(239, 68, 68, 0.1)'}
        ]
        
        for regime in regimes:
            fig.add_hrect(
                y0=regime['min'],
                y1=regime['max'],
                fillcolor=regime['color'],
                layer='below',
                line_width=0,
                annotation_text=regime['name'],
                annotation_position='left top',
                annotation_font_size=10,
                annotation_font_color=self.colors['muted']
            )
    
    def _add_streak_markers(self, fig: go.Figure, df: pd.DataFrame):
        """Add markers for detected streaks."""
        # Simple streak detection - consecutive high multipliers
        high_multiplier_threshold = 5.0
        streak_length = 3
        
        high_mask = df['multiplier'] >= high_multiplier_threshold
        streak_starts = []
        
        for i in range(len(df) - streak_length):
            if high_mask[i:i+streak_length].all():
                streak_starts.append(i)
        
        # Add markers for streak starts
        if streak_starts:
            streak_timestamps = df.iloc[streak_starts]['timestamp']
            streak_values = df.iloc[streak_starts]['multiplier']
            
            fig.add_trace(go.Scatter(
                x=streak_timestamps,
                y=streak_values,
                mode='markers',
                name='Streak Start',
                marker=dict(
                    color=self.colors['gold'],
                    size=12,
                    symbol='star',
                    line=dict(color=self.colors['background'], width=2)
                ),
                showlegend=False
            ))
    
    def _add_band_boundaries(self, fig: go.Figure, df: pd.DataFrame):
        """Add horizontal lines for band boundaries."""
        band_ranges = self.scaler.get_band_ranges()
        
        for band_name, (min_scaled, max_scaled) in band_ranges.items():
            fig.add_hline(
                y=max_scaled,
                line_dash='dash',
                line_color=self.colors['muted'],
                line_width=1,
                annotation_text=f'{band_name} max',
                annotation_position='right',
                annotation_font_size=8,
                annotation_font_color=self.colors['muted']
            )


def create_visualizer(threshold: float = 5.0) -> PlotlyVisualizer:
    """
    Factory function to create a PlotlyVisualizer instance.
    
    Args:
        threshold: Threshold for hybrid scaling (default: 5.0)
        
    Returns:
        Configured PlotlyVisualizer instance
    """
    return PlotlyVisualizer(threshold=threshold)


# Example usage
if __name__ == "__main__":
    # Create sample data
    import random
    from datetime import timedelta
    
    base_time = datetime.now()
    sample_data = []
    
    multipliers = [1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 50.0, 100.0]
    weights = [0.45, 0.25, 0.15, 0.08, 0.05, 0.015, 0.005, 0.0005, 0.0005]
    
    for i in range(100):
        multiplier = random.choices(multipliers, weights=weights)[0]
        color = "red" if multiplier >= 2.0 else "green"
        timestamp = base_time - timedelta(seconds=i * 45)
        
        sample_data.append({
            "multiplier": multiplier,
            "color": color,
            "timestamp": timestamp.isoformat()
        })
    
    # Create visualizer
    visualizer = create_visualizer()
    
    # Create candlestick chart
    candlestick_fig = visualizer.create_candlestick_chart(sample_data)
    print("Candlestick chart created successfully")
    
    # Create scaled chart
    scaled_fig = visualizer.create_scaled_chart(sample_data)
    print("Scaled chart created successfully")
    
    # Create combined score chart
    scores = [random.random() for _ in range(len(sample_data))]
    score_fig = visualizer.create_combined_score_chart(sample_data, scores)
    print("Combined score chart created successfully")
    
    # Save charts as HTML
    candlestick_fig.write_html("/tmp/candlestick_chart.html")
    scaled_fig.write_html("/tmp/scaled_chart.html")
    score_fig.write_html("/tmp/score_chart.html")
    
    print("Charts saved to /tmp/")
