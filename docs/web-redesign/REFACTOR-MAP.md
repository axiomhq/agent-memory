# agent-memory web UI — current-state map (before refactor)

Baseline: `agentmemory-local-improvements @ 1f42444`. One file, `src/cli/web.ts`,
3,006 lines, mixing HTTP server + ~24 route handlers + data-derivation/markdown
helpers + two divergent inline UIs. No CSP/nonce. No frontend build step (Bun,
server-rendered HTML + vanilla JS).

Fixture store for local runs: `_fixture-store/` (8 entries across `default` +
`workpacker` orgs, plus `.todos.json` with 5 todos). Config: `memory.config.json`.
Boot: `bun src/cli/index.ts web --port 3939`.

## The two UIs (the core disaster)

| | `/` — `renderLandingPage` (line 646) | `/old` — `renderPage` (line 921) |
|---|---|---|
| Aesthetic | Light, heavy black borders, "work order register" / paper-form look | Dark gradient, glass panels, teal/amber accents |
| Render | **Server-rendered** with data baked in (stats, todos, recent curated) | **Shell only**, hydrates client-side from JSON APIs |
| Job | Dashboard: counts, active work orders (todos), quick links, recent curated | Full browser/editor: list + filters + reader + inline edit + capture |
| CSS | Its own ~200-line `<style>` | Its own ~480-line `<style>` (separate `:root` token set) |
| Type system | shares serif/sans/mono vars but different scale/color | divergent |

Two design languages, two CSS blocks, zero shared styling. Goal #3 (one design
system) = collapse these into a single token set + shell + per-view renderers.

## Routes → views → data

**Pages**
- `GET /` → `renderLandingPage(baseUrl, stats, todos, recentMemories)` — server-rendered dashboard.
- `GET /old` → `renderPage(baseUrl)` — client-hydrated browser.

**Read APIs**
- `GET /api/meta` → `{root, defaultOrg, orgs[], count, counts{curated,candidates,rawArchive,actionRequired,total}, health{ok}}`. Used by `/old` shell.
- `GET /api/stats` → `{curated, archive, candidates, stale, duplicates, todos{active,done,total}}`. Landing-style counts.
- `GET /api/entries?query&org&source&view&limit` → `{entries[], total, limit}`. Drives `/old` list.
- `GET /api/entries/:id` → `{entry{...rich derived HTML sections...}, links}`. Drives `/old` reader.
- `GET /api/memories?search&org&tier&class&source&topic&limit&offset` → `{memories[], total, filtered, limit, offset}`. **Near-duplicate of `/api/entries`** with richer filter set + pagination. Currently only lightly used.
- `GET /api/memories/:id` → single memory detail.

**Write APIs — entries** (legacy path)
- `POST /api/entries` · `PUT /api/entries/:id` · `DELETE /api/entries/:id`

**Write APIs — memories** (newer path, overlaps entries)
- `POST /api/memories` · `PUT /api/memories/:id`
- `POST /api/memories/:id/promote` (curate) · `POST /api/memories/:id/flag-stale`

**Write APIs — todos** (`.todos.json` at store root)
- `GET /api/todos?status` · `POST /api/todos`
- `POST /api/todos/:id/complete` · `POST /api/todos/:id/priority`
- `PATCH /api/todos/:id` · `DELETE /api/todos/:id`

## Data model (all DERIVED, nothing stored as metadata)

Entries are pure markdown at `orgs/{org}/archive/{slug} id__XXXXXX.md`.
`web.ts` derives a richer model than `schema.ts` exposes — these types live ONLY
in `web.ts`:

- `SourceKind`: chatgpt | claude | codex | project_context | manual | unknown — from `source__*` tag / body `Source:` / provider line.
- `EntryTier`: curated | raw_archive | unknown — from `tier__*` tag (or bare `curated`).
- `EntryClass[]`: raw_import | curated | curated_candidate | duplicate | stale | superseded | action_required | project_context — from `class__*` tags.
- `TopicKind[]`: workpacker | agent_memory | mcp | github | ssen | infra — from `topic__*` tags.
- Body normalized fields parsed into sections: `Context`, `Type`, `Summary`,
  `Operational memory`, `Commands / config`, `Applies to`, `Source`, `Confidence`,
  plus `<details><summary>Raw content</summary>`.

`EntryView` (the 5 `/old` filter chips): curated | candidates | raw | action | all
— `matchesView()` maps tier/class to each.

Todos: `.todos.json` `{version:1, todos: TodoItem[]}`; `TodoItem` has
status (open|doing|blocked|done|parked), priority (low|normal|high), optional
`sourceEntryId`/`sourceTitle` linking back to an entry.

## Helper layer (lines ~130–640, candidate for `derive.ts` + `markdown.ts`)

- Markdown: `renderInlineMarkdown`, `renderMarkdown` (hand-rolled), `esc`.
- Section extraction: `extractMarkdownSection`, `removeMarkdownSection`,
  `extractDetailsBlock`, `normalizedField`, `cleanDisplaySection`, etc.
- Classification: `inferSource`, `inferTier`, `inferClasses`, `inferTopics`,
  `countEntries`, `matchesView`, `deriveBrowserEntry`.
- Todos: `readTodoStore`/`writeTodoStore`, validators, sort/filter/stats.

## Observations for the eng/IA plan

1. **`/api/entries` and `/api/memories` are ~90% duplicate** (both list → read each
   body → derive → filter → sort). Same for their write siblings. The refactor
   should pick ONE memory API and retire the other (don't change response shapes
   that survive).
2. **N+1 file reads**: every list endpoint calls `service.read()` for every entry
   on every request to derive bodies. Fine at 8 fixtures, O(n) disk at scale.
   Note for perf, not blocking the redesign.
3. **IA is light**: it's 5 filter-chips + a todos surface + a dashboard, not many
   tabs. Goal #2 reduces to: make the memory browser the home, fold the landing
   dashboard's stats/todos in as supporting surfaces, drop `/old` as a separate
   design once unified.
4. **No CSP/nonce exists** — the briefing's nonce constraint is void. If we want
   CSP later it's net-new, not a preservation requirement.

## Proposed target layout (for step 3, not yet implemented)

```
src/cli/web.ts            # thin: parseArgs + Bun.serve + route table only
src/web/router.ts         # route dispatch
src/web/api/{entries,memories,todos,meta,stats}.ts   # handlers (one memory API)
src/web/derive.ts         # classification + section extraction
src/web/markdown.ts       # renderMarkdown / renderInlineMarkdown / esc
src/web/view/tokens.ts    # ONE design-token stylesheet (dark default, light = token swap)
src/web/view/shell.ts     # page shell renderer
src/web/view/{browser,dashboard}.ts   # per-view renderers, one design system
```

Ship order: (1) structural split, no visual change (one reviewable diff);
(2) unify to one design system on top of the clean structure.
