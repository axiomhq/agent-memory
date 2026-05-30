# API Endpoints Parity: /api/entries vs /api/memories

## Overview

Both `/api/entries` and `/api/memories` serve the same underlying memory data. This document captures the equivalence and differences between them for the `/old` UI.

## Response Structure Parity

### List Endpoints

**`GET /api/entries?...`** → `{ entries: [...], total: N, limit: N }`
**`GET /api/memories?...`** → `{ memories: [...], total: N, filtered: N, limit: N, offset: 0 }`

Both return the same entry objects with fields: `id`, `title`, `tags`, `org`, `source`, `tier`, `classes`, `topics`, `excerpt`, `createdAt`, `updatedAt`, `displayDate`.

**Client adjustment (WORKPAC-800):** `/old` now accesses `data.memories` instead of `data.entries`.

### Detail Endpoints

**`GET /api/entries/:id`** → `{ entry: {...}, links: null }`
**`GET /api/memories/:id`** → `{ memory: {...}, links: null }`

Both carry the same full entry object with fields: `id`, `title`, `tags`, `org`, `body`, `source`, `tier`, `classes`, `topics`, plus HTML-rendered sections (`contextHtml`, `summaryHtml`, `operationalHtml`, `contentHtml`, `appliesToHtml`, `confidenceHtml`, `commandsHtml`, `metadataHtml`, `rawSourceHtml`), and date fields.

**Client adjustment (WORKPAC-800):** `/old` now accesses `data.memory` instead of `data.entry`.

### Query Parameters

**`/api/entries`** uses:
- `query` — full-text search
- `view` — "curated" | "candidates" | "raw" | "action" | "all"
- `org`, `source`, `topic`, `limit`

**`/api/memories`** uses:
- `search` or `query` — full-text search (both supported)
- `tier` — "curated" | "raw_archive" (replaces view for tier-based filtering)
- `class` — "curated_candidate" | "action_required" (replaces view for class-based filtering)
- `org`, `source`, `topic`, `limit`, `offset`

**Client adjustment (WORKPAC-800):** `/old` maps the `view` parameter to equivalent `tier` or `class` query params:
- `view=curated` → `tier=curated`
- `view=raw` → `tier=raw_archive`
- `view=candidates` → `class=curated_candidate`
- `view=action` → `class=action_required`
- `view=all` → no filter params

## Testing

Golden fixtures test: `test/web-api-golden.test.ts`

**Coverage:**
- List endpoint returns equivalent entries from both `/api/entries` and `/api/memories`
- Detail endpoint returns equivalent full entry data from both endpoints
- `/api/memories` provides all fields `/old` consumes

**Status:** ✅ All 3 tests pass with 129 assertions

## Mutation Endpoints (Create, Update, Delete)

All mutation endpoints follow the same pattern:
- **POST** (create): `/api/memories` — no `/api/entries` equivalent in new code
- **PUT** (update): `/api/memories/:id` — no `/api/entries` equivalent in new code
- **DELETE** (delete): `/api/memories/:id` — no `/api/entries` equivalent in new code

Response structure uses `memory` key for consistency with GET detail.

## Notes for WORKPAC-790

When retiring `/api/entries`:
1. All fields are equivalent or superseded by `/api/memories`
2. No special compat layer needed; response structures differ only in field naming
3. `/old` client already migrated to use `/api/memories` (WORKPAC-800)
4. Golden fixtures verify equivalence before deletion

## Notes for Implementation Details

- Both endpoints invoke the same service methods (`service.read()`, `service.list()`)
- Field derivation (`source`, `tier`, `classes`, `topics`) happens server-side via `deriveBrowserEntry()`
- Response differs only in wrapper field names (`entry`/`entries` vs `memory`/`memories`) and pagination fields (`filtered`, `offset`)
- Client adjusts via field name mapping; no business logic changes required
