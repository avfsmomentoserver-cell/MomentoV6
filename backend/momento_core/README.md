# Momento Core

The intelligent heart of the Momento/AVFS Core platform, providing database models, API services, and MomentoLinguistics integration for analytics and forecasting.

## Overview

Momento Core is a comprehensive Python package that implements the core functionality of the Momento/AVFS Core platform, including:

- **Database Layer**: SQLAlchemy ORM models with environment-agnostic configuration (SQLite/PostgreSQL)
- **API Layer**: FastAPI routes with business logic services following layered architecture
- **Linguistics Integration**: 8-layer MomentoLinguistics engine for semantic market behavior classification
- **Testing**: Comprehensive test coverage for all core modules

## Installation

```bash
# Add to your Python path or install as a package
cd /home/pirates/Avfs_Core/avfs/tmp/core
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
```

## Quick Start

### Database Initialization

```python
from momento_core.db.session import init_db

# Initialize database tables
init_db()
```

### Using the API

```python
from momento_core.api.main import app
import uvicorn

# Run the FastAPI server
uvicorn.run(app, host="0.0.0.0", port=8000)
```

### MomentoLinguistics Conversion

```python
from momento_core.linguistics import MomentoLinguisticsEngine

# Create engine
engine = MomentoLinguisticsEngine()

# Convert multiplier to linguistic object
linguistic_obj = engine.convert(
    multiplier=1.22,
    timestamp="2026-07-19T07:00:00Z",
    color="rgb(52, 180, 255)"
)

# Access linguistic layers
print(f"Market Classification: {linguistic_obj.layer2_market}")
print(f"Energy Level: {linguistic_obj.layer3_energy}")
print(f"Behaviour: {linguistic_obj.layer4_behaviour}")
```

## Architecture

### Database Layer

The database layer provides SQLAlchemy ORM models following project conventions:

- **Base Models**: `BaseModel` with common fields, `TimestampMixin` for auto-managed timestamps
- **Environment Support**: SQLite for local development, PostgreSQL for production
- **Naming Conventions**: snake_case tables, `id` primary keys, foreign keys with `_id` suffix

#### Available Models

- `CollectedData`: Raw ingested data (immutable events principle)
- `Metric`: Analysis results and computed metrics
- `ForecastResult`: Predictive model outputs with confidence intervals
- `DataSource`: External data source configuration
- `User`: Platform user accounts
- `Task`: Async job tracking for long-running operations

### API Layer

The API layer follows a service-oriented architecture:

```
Route Handlers → Service Functions → Database Operations
```

#### Available Endpoints

- `POST /api/v1/ingest` - Data ingestion from Collector module
- `GET /api/v1/metrics` - Retrieve computed metrics
- `GET /api/v1/forecasts` - Retrieve forecast results
- `GET /api/v1/health` - Health check endpoint

#### Service Functions

- `IngestService`: Data ingestion business logic
- `MetricsService`: Metrics retrieval and filtering
- `ForecastService`: Forecast retrieval and filtering

### Linguistics Layer

The MomentoLinguistics engine provides 8-layer semantic classification:

1. **Layer 0**: Raw Observation (preserved multiplier)
2. **Layer 1**: Point Representation (normalized mathematical space)
3. **Layer 2**: Market Classification (Blue/Purple/Pink/Gold/Extreme)
4. **Layer 3**: Energy Language (Tiny/Violent/Exhaustion/Recovery)
5. **Layer 4**: Behaviour Language (Compression/Expansion/Recovery/etc.)
6. **Layer 5**: Point Language (semantic meaning, probability significance)
7. **Layer 6**: Relationship Language (mirror/expansion/compression analysis)
8. **Layer 7**: Gap Language (neighbour pair analysis with velocity/direction)
8. **Layer 8**: Shape Language (Mirror/Peak/Valley/Ladder/Wave patterns)

## Configuration

### Environment Variables

```bash
# Environment (local or production)
export ENVIRONMENT="local"

# Database configuration
export DATABASE_URL="postgresql://user:pass@host:port/dbname"  # Production
export SQLITE_DB_PATH="avfs.db"  # Local

# Connection pool settings (production only)
export DB_POOL_SIZE="5"
export DB_MAX_OVERFLOW="10"
export DB_POOL_TIMEOUT="30"
export DB_POOL_RECYCLE="3600"
```

## Testing

Run the test suite:

```bash
# Run all tests
pytest core/momento_core/tests/

# Run specific test file
pytest core/momento_core/tests/test_db_models.py

# Run with coverage
pytest core/momento_core/tests/ --cov=momento_core --cov-report=html
```

### Test Coverage

- `test_db_models.py`: SQLAlchemy ORM model tests
- `test_linguistics.py`: MomentoLinguistics conversion tests
- `test_api_services.py`: Service layer business logic tests

## API Documentation

Once the FastAPI server is running, access auto-generated documentation:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Project Standards Compliance

This implementation follows all Momento/AVFS Core project standards:

✅ SQLAlchemy 2.0+ style with `Mapped` type hints
✅ Service layer pattern (routes delegate to services)
✅ Pydantic validation for all API endpoints
✅ Environment-agnostic database configuration
✅ Comprehensive test coverage
✅ Google-style docstrings
✅ Explicit type hints on all functions
✅ Follows architectural constraints from `.kiro/steering/`

## Module Structure

```
momento_core/
├── db/                    # Database layer
│   ├── base.py           # SQLAlchemy base and mixins
│   ├── config.py         # Database configuration
│   ├── session.py        # Session management
│   └── models/           # ORM model definitions
├── api/                   # API layer
│   ├── main.py           # FastAPI application
│   ├── models/           # Pydantic request/response models
│   ├── routes/           # Route handlers
│   └── services/         # Business logic services
├── linguistics/           # MomentoLinguistics integration
│   ├── models.py         # Linguistic data models
│   └── engine.py         # Conversion engine
├── tests/                # Test suite
│   ├── test_db_models.py
│   ├── test_linguistics.py
│   └── test_api_services.py
└── docs/                 # Documentation
    └── ADR-0001-momento-core-architecture.md
```

## Dependencies

- FastAPI >= 0.100.0
- SQLAlchemy >= 2.0.0
- Pydantic >= 2.0.0
- pytest >= 7.0.0
- uvicorn >= 0.20.0

## Related Documentation

- [ADR-0001: Momento Core Architecture](docs/ADR-0001-momento-core-architecture.md)
- [Project Architecture](../../.kiro/steering/architecture.md)
- [Module Specifications](../../.kiro/steering/modules.md)
- [Coding Standards](../../.kiro/steering/coding-standards.md)
- [Agent Team Structure](../../.kiro/steering/agent-team.md)

## License

Part of the Momento/AVFS Core platform. See project license for details.
