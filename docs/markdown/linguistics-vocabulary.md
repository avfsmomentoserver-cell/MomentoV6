# Linguistics & Vocabulary

## MomentoLinguistics

Every round is mapped to a semantic token composed of measurable layers:

| layer | values |
| --- | --- |
| band | <1.5× · 1.5–2× · 2–5× · 5–10× · 10–100× · 100×+ |
| chroma | normalized round color |
| streak | break · dry0…dry9 (consecutive below-2× count) |
| transition | prevBand→band |
| momentum | rising / fading / flat (5-round look) |
| pressure | calm / building / loaded |
| shape | live curve classification |

`GET /api/v1/linguistics?depth=200` returns the token stream, token frequencies, and the layer definitions. `/dashboard/linguistics` renders the live stream and frequency table.

## The Vocabulary Learning System

The eight-layer vocabulary has a full lifecycle, ported from the original vocabulary modules:

1. **Discover** — `POST /api/v1/vocabulary/discover` derives candidate tokens from the live series (high-round transitions, dry-streak states).
2. **Evaluate** — candidates are scored against outcomes (`hits`, `misses`, `uses` → `score`).
3. **Formalize** — tokens whose score earns it are promoted into the formal vocabulary.
4. **Deprecate** — tokens that stop earning are deprecated, never deleted.

`/dashboard/vocabulary` is the management surface: status filters, manual tokens, discovery passes, formalize/deprecate actions, learning status and progress endpoints. Bulk import uses `POST /api/v1/import` with `{entity: "vocabulary", rows}`.
