# ADR-0001: Momento Core Architecture

**Date**: 2026-07-19
**Status**: Accepted

## Context

The Momento/AVFS Core platform requires a centralized core implementation that provides:
- Database models and session management for both local (SQLite) and production (Supabase/PostgreSQL) environments
- FastAPI routes and business logic services following the project's layered architecture
- Integration with the existing MomentoLinguistics engine for semantic market behavior classification
- Comprehensive test coverage for all core modules
- Adherence to project coding standards and architectural constraints

The existing codebase had documentation and specifications in `.kiro/steering/` but lacked a unified, importable core package that could be used across the platform.

## Decision

Implement `momento_core` as a comprehensive Python package under the `core/` directory with the following structure:

```
core/momento_core/
├── __init__.py
├── db/
│   ├── __init__.py
│   ├── base.py          # SQLAlchemy base and mixins
│   ├── config.py        # Database configuration
│   ├── session.py       # Session management
│   └── models/
│       ├── __init__.py
│       ├── collected_data.py
│       ├── metric.py
│       ├── forecast_result.py
│       ├── data_source.py
│       ├── user.py
│       └── task.py
├── api/
│   ├── __init__.py
│   ├── main.py          # FastAPI app creation
│   ├── models/          # Pydantic request/response models
│   │   ├── __init__.py
│   │   ├── ingest.py
│   │   ├── metrics.py
│   │   └── forecasts.py
│   ├── routes/          # FastAPI route handlers
│   │   ├── __init__.py
│   │   ├── ingest.py
│   │   ├── metrics.py
│   │   ├── forecasts.py
│   │   └── health.py
│   └── services/        # Business logic services
│       ├── __init__.py
│       ├── ingest_service.py
│       ├── metrics_service.py
│       └── forecast_service.py
├── linguistics/
│   ├── __init__.py
│   ├── models.py        # MomentoLinguistics data models
│   └── engine.py        # Conversion engine
├── tests/
│   ├── __init__.py
│   ├── test_db_models.py
│   ├── test_linguistics.py
│   └── test_api_services.py
└── docs/
    └── ADR-0001-momento-core-architecture.md
```

### Key Architectural Decisions

1. **SQLAlchemy 2.0+ Style**: Use `Mapped` type hints for all ORM model fields following SQLAlchemy 2.0 conventions.

2. **Environment-Agnostic Database Layer**: Support both SQLite (local) and PostgreSQL (production) through configuration-based connection strings.

3. **Service Layer Pattern**: Route handlers delegate to service functions for business logic, maintaining separation of concerns.

4. **Pydantic Validation**: All API request/response bodies use Pydantic models for validation and documentation.

5. **MomentoLinguistics Integration**: Embed the linguistic conversion engine within the core package for seamless semantic classification.

6. **Comprehensive Testing**: Provide unit tests for database models, API services, and linguistics integration.

## Alternatives Considered

### Alternative 1: Separate Packages per Module
Create separate packages for database, API, and linguistics (e.g., `momento_db`, `momento_api`, `momento_linguistics`).

**Rejected**: This would increase complexity and inter-package dependencies. A unified core package simplifies imports and ensures consistency.

### Alternative 2: Direct Database Access in Routes
Implement business logic directly in FastAPI route handlers without a service layer.

**Rejected**: Violates the project's architectural constraint that route handlers must delegate to services. Would make testing difficult and violate separation of concerns.

### Alternative 3: External MomentoLinguistics Dependency
Keep MomentoLinguistics as a separate dependency rather than embedding it in the core.

**Rejected**: The linguistics engine is core to the platform's semantic analysis capabilities. Embedding it ensures version compatibility and simplifies deployment.

## Consequences

### Positive

- **Unified Interface**: Single import point for all core functionality (`from momento_core import ...`)
- **Type Safety**: Comprehensive type hints throughout the codebase
- **Testability**: Service layer enables easy unit testing without HTTP overhead
- **Environment Flexibility**: Seamless switching between local and production databases
- **Standards Compliance**: Follows all project coding standards and architectural constraints
- **Documentation**: Auto-generated OpenAPI docs via FastAPI and Pydantic models

### Negative

- **Package Size**: The core package includes multiple subsystems, making it larger than a single-purpose package
- **Learning Curve**: Developers must understand the layered architecture (routes → services → database)
- **Migration Complexity**: Existing code may require refactoring to use the new core package structure

### Technical Debt Created

- **Future Module Extraction**: If linguistics or database layers need to become independent packages, they will need to be extracted from the unified core
- **Configuration Management**: Database configuration may need enhancement for more complex production scenarios (connection pooling, read replicas)

## Implementation Notes

### Database Models

All models follow the project's naming conventions:
- Table names: snake_case plural (`collected_data`, `forecast_results`)
- Primary key: `id` (auto-increment integer)
- Foreign keys: `<referenced_table_singular>_id` (e.g., `data_source_id`)
- Timestamps: `created_at` and `updated_at` (auto-managed)
- Relationships: Declared on owning side with proper cascade behavior

### API Services

Service functions:
- Accept database session as constructor parameter
- Return ORM model instances or domain objects
- Raise `ValueError` for validation failures
- Handle database transactions (commit/rollback)
- Include Google-style docstrings

### MomentoLinguistics Integration

The linguistics engine:
- Implements 8-layer linguistic architecture
- Converts raw multipliers to semantic objects
- Provides market classification, energy language, behavior analysis
- Supports shape detection and macro regime classification
- Maintains compatibility with existing `momento_linguistics_engine.py`

### Testing

Test coverage includes:
- Database model creation and relationships
- API service business logic
- MomentoLinguistics conversion across all layers
- Edge cases and error handling
- Fixture-based test data setup

## Related Documentation

- [architecture.md](../../.kiro/steering/architecture.md) - Layered architecture and module boundaries
- [modules.md](../../.kiro/steering/modules.md) - Detailed module specifications
- [coding-standards.md](../../.kiro/steering/coding-standards.md) - Python and TypeScript conventions
- [agent-team.md](../../.kiro/steering/agent-team.md) - Specialized agent roles and responsibilities
- [skills-library.md](../../.kiro/steering/skills-library.md) - Reusable AI capabilities catalog
