# agent-memory web UI — redesign plan

Companion to `REFACTOR-MAP.md` (current-state map). This file captures the design
decisions resolved during `/plan-design-review`. Baseline: `agentmemory-local-improvements @ 1f42444`.
Stack: Bun, zero new deps, no bundler, server-rendered HTML + vanilla JS. Dark default.

## Design score: 3/10 → (in progress)

---

## Pass 1 — Information Architecture ✅ (decided)

**Decision: Browser-as-home with folded panels.** Collapse the two UIs into ONE screen.

- The 3-pane memory browser becomes `/`. `/old` retires (301 → `/` or just removed).
- **Left rail:** a slim stats strip at top (curated / archive / candidates / action
  counts), then filter groups (tier, class chips, source, topic) + org selector + search.
- **Center:** scannable memory list (title, metadata chips, excerpt, date).
- **Right:** reader/editor pane for the selected entry (normalized sections).
- **NO "work orders."** The landing page's work-order register styling (WO-001 priority
  cards, paper-form borders, "work order register" framing) is REMOVED entirely. This is
  a memory app; the hero is memories. See Pass 1b for what happens to the todos feature.

```
┌── agent-memory ──── search ─────── stats strip ──┐
│ FILTERS │  MEMORY LIST        │  READER / EDITOR  │
│ tier    │  • title  chips     │  ## Context       │
│ class   │    excerpt    date  │  ## Summary       │
│ source  │  • title  chips     │  ## Commands      │
│ topic   │  ...                │  [edit] [delete]  │
│ ─────── │                     │                   │
│ ▸ Work  │                     │                   │
│   orders│                     │                   │
└─────────┴─────────────────────┴───────────────────┘
```

Rationale: memory entries are the hero content; the dashboard's stats/todos are
supporting context, not a destination. One screen kills the duplicate-CSS / two-design
problem at the root. (Principle: subtraction default; hierarchy as service.)

Reuse: grow the unified system from the `/old` dark `:root` token set (serif/sans/mono,
spacing, radius already exist), not the light "work order" look.

## Pass 1b — Todos feature ✅ (decided, user-directed)

User: "we don't need work orders, this is a memory app, remove 'work order' styling."

**Decision: keep todos as a plain de-branded "Tasks" list.** The `/api/todos` CRUD +
`.todos.json` backend stays. The UI becomes a quiet collapsible "Tasks" panel in the
left rail — title, status dot, done checkbox, priority as a subtle marker. No WO-NNN
ids, no priority color banners, no paper-form borders, no "work order register" copy.
Memory entries remain the hero; Tasks are secondary supporting context.

```
▸ Tasks (4)
  ○ Refactor web.ts into modules
  ○ Unify design system
  ✓ Back up sunny working copy
```

## Pass 2 — Interaction State Coverage ✅ (decided)

**Decision: distinct, warm states** (not one generic "nothing here"):

| Surface | Loading | Empty | Error | Partial |
|---|---|---|---|---|
| Memory list | skeleton rows (3-4) | **first-run**: "No memories yet. Agents write here via `memory capture` or MCP." + [New entry] [Docs]. **zero-match**: "No memories match these filters." + [Clear filters] | inline banner "Couldn't load memories — retry" + retry | n/a |
| Reader | quiet spinner in pane | "Select a memory to read." (calm prompt, not error) | "Couldn't open this entry." + id | raw_archive entry with only a `<details>` blob → show the raw block, label it "Raw import" |
| Tasks panel | — | "No tasks." (one line, muted) | toast on write failure | — |
| Save/edit | button → saving state, disabled | — | inline error under the field, keep draft | optimistic row update, rollback on failure |

Empty states are features: each carries context + one primary action. First-run is
distinguished from filtered-to-zero so users can tell "no data" from "over-filtered."

## Pass 3 — User Journey ✅ (decided)

**Decision: scan-first, curated default.** On load `/` shows the curated list,
newest first, with the **search field focused** and NO entry auto-opened (reader shows
the calm "Select a memory to read." prompt). Optimizes for the dominant task: find,
then read. Raw imports stay behind the filter so first impression is high-signal.

## Pass 4 — AI Slop Risk ✅ (decided)

Classifier: **App UI** (dense data workspace). **Decision: flat calm surfaces.** Remove
the radial-gradient background blobs, glassmorphism blur, and gradient buttons from
`/old`. Surface tokens:

```
--bg:      #0d1117   /* app background */
--panel:   #131820   /* list + rail, flat + 1px border */
--raised:  #171d26   /* reader pane, hover */
--border:  #232a33   /* hairline 1px */
--accent:  #2dd4bf   /* solid teal, used sparingly: selection, primary btn, focus ring */
```

Buttons: solid fill, no gradient. Selection affordance: left-edge accent bar on the
active list row (functional, not decorative). No card mosaic — dense rows with hairline
separators. App UI rules satisfied.

## Pass 5 — Design System (typography) ✅ (decided)

No DESIGN.md (gap — recommend `/design-consultation` to formalize tokens later).
**Decision: curated native font stack** (zero network, not bare `system-ui`).
**UPDATED in /design-consultation — serif dropped.** Agent memories are structured
technical notes, not prose, so serif clashed with the utilitarian aesthetic. Now one
sans + mono voice (see `DESIGN.md`):

```
--sans:  'Avenir Next', 'Segoe UI', system-ui, sans-serif;   /* titles, headings, UI, body */
--mono:  'SF Mono', 'Cascadia Code', ui-monospace, monospace; /* metadata chips, code */
/* no --serif */
```

Type scale (one ramp, rem): 0.75 / 0.82 / 0.9 / 1.0 / 1.15 / 1.34 / 1.55. Body/reader
≥ 16px, contrast ≥ 4.5:1 (slop/universal rules). Light mode = swap the `--bg/panel/
raised/border/text` tokens only; one stylesheet, `:root` + `:root[data-theme=light]`.

## Pass 6 — Responsive & Accessibility ✅ (decided)

**Decision: master-detail drill-down.**
- **Desktop (≥1100px):** 3 panes `[rail][list][reader]`.
- **Tablet (700–1100px):** rail → `☰` toggle; list + reader side-by-side.
- **Mobile (<700px):** single column showing the list; tapping an entry slides the
  reader in as a full-screen view with a back button; filters open as a bottom sheet.

**A11y baseline (baked in, not optional):**
- Keyboard: `/` focuses search; ↑/↓ move list selection; Enter opens; Esc closes
  reader/back on mobile; full tab order through rail → list → reader.
- Visible focus ring (`--accent`, 2px) on every interactive element.
- ARIA: `role="navigation"` rail, `role="list"`/`listitem` entries,
  `aria-selected` on active row, `aria-live="polite"` on the count + save status.
- Touch targets ≥ 44px on mobile; chips/checkboxes get adequate hit area.
- Motion: 120–160ms ease transitions on selection/hover/panel toggle; respect
  `prefers-reduced-motion` (disable slides/transitions).

## Pass 7 — Unresolved Decisions

**Resolved (design):** list row density → **comfortable** (serif title, chip row,
one-line excerpt, right-aligned date; ~3 lines).

**Deferred to `/plan-eng-review` (not design calls):**
| Decision | If deferred | 
|---|---|
| Keep `/api/entries` OR `/api/memories` (90% duplicate) | both ship and drift |
| Hand-rolled markdown renderer: keep vs harden | edge-case bugs in hero content |
| `/old` route: 301→`/` vs delete | stale bookmarks 404 |
| N+1 reads per list request (reads every body) | O(n) disk at scale |

---

## NOT in scope (explicitly deferred)

- Web fonts / custom typeface (native stack chosen; revisit with `/design-consultation`).
- Density toggle (shipping comfortable-only; toggle is a later enhancement).
- Formal DESIGN.md (recommended next, not blocking this redesign).
- Full mobile gesture polish beyond the master-detail drill-down (swipe-back, etc.).

## What already exists (reuse, don't reinvent)

- `/old` `:root` token system (serif/sans/mono, spacing, radius) — the unified system
  grows from this, restyled flat per Pass 4.
- `deriveBrowserEntry` + classification (`inferTier/Classes/Topics/Source`) and the
  normalized-section parser — keep as the data layer (move to `derive.ts`).
- `renderMarkdown` / `renderInlineMarkdown` — keep (move to `markdown.ts`), harden later.
- All JSON API response shapes — unchanged (presentation-only redesign).

## Deferred TODOs (design debt)

1. **Formalize DESIGN.md** via `/design-consultation` — lock tokens/components as source of truth.
2. **Density toggle** — comfortable/compact persisted to localStorage.
3. **Light-mode contrast audit** — verify the token swap hits 4.5:1 everywhere.
4. **Mobile gesture polish** — swipe-to-back on the reader drill-down.

## Design score: 3/10 → 8/10

| Pass | Before | After |
|---|---|---|
| 1 Information Architecture | 2 | 8 |
| 2 Interaction States | 3 | 8 |
| 3 User Journey | 4 | 8 |
| 4 AI Slop Risk | 5 | 9 |
| 5 Design System | 5 | 8 |
| 6 Responsive & A11y | 3 | 8 |
| 7 Unresolved | — | 1 resolved, 4 → eng |

## Eng-review decisions

- **API consolidation moves BEFORE the redesign** (WORKPAC-790 resequenced). Split first,
  consolidate the duplicate entry/memory API, then build the unified UI against the single
  surviving endpoint so the frontend is never wired to the endpoint that gets deleted.

### Architecture (Section 1)
- **Keep `/api/memories`, retire `/api/entries`** (+ its POST/PUT/DELETE). Memories is the
  richer surface (tier/classes/topics, pagination, richer filters) the unified UI needs.
- **Render boundary: API returns raw, view renders.** Detail endpoint returns structured
  raw markdown sections; `view/reader.ts` calls `markdown.ts`. `derive.ts` stays pure data
  (no HTML). **This relaxes the original "don't change API shapes" rule for the detail
  endpoint** — acceptable since the UI is being rewritten. List shape stays stable.
- **First paint: SSR initial curated list, hydrate after.** `/` server-renders the default
  list (no loading flash, degrades without JS); vanilla JS hydrates search/filter/select via
  `/api/memories`. Skeleton states apply to post-load fetches, not first paint.

### Code quality (Section 2)
- **Extract one `listMemories(service, filters)`** in `derive.ts`. The list→read→derive→
  filter→sort loop is currently triplicated (entries/memories/landing); both surviving
  callers (api/memories + landing SSR) use the single helper. One place to test.
- Minor (appendix): the `isErr → json(500)` boilerplate repeats across handlers; a small
  `unwrap()`/`handleResult()` helper would tidy it. Low priority, fold opportunistically.

### Tests (Section 3) — web.ts currently has ZERO coverage
- **Golden snapshot (M1 safety net):** `test/web-golden.test.ts` renders `/` and `/old`
  against the fixture store and asserts byte-identical output across the split. Guards the
  "no visual change" promise. **Mandatory regression guard.**
- **Unit tests** for the now-pure modules:
  - `test/web-markdown.test.ts` — headings, lists (nested/ordered), code fences, inline
    (code/bold/links/`[[wikilink]]`). Also satisfies M3 renderer hardening (WORKPAC-791).
  - `test/web-derive.test.ts` — `inferTier/Classes/Topics/Source`, `deriveBrowserEntry`
    section extraction, `countEntries`, `matchesView`, `listMemories` filter+sort+paginate.
  - `test/web-api.test.ts` — `/api/memories` filters+pagination, `/api/todos` CRUD.
- Test-plan artifact written for `/qa` consumption under `~/.gstack/projects/`.

### Outside voice (Claude subagent) — corrections to the plan

The independent challenge caught two real flaws (codex-spark unsupported, gemini quota
exhausted; used Claude subagent fallback):

- **CONFIRMED — golden HTML snapshot guards the wrong layer + bad ordering.** `/old` is a
  shell that hydrates from `/api/entries` (verified: web.ts:1947/2116/2137/2159/2173).
  Retiring `/api/entries` in M1 breaks `/old`, and an HTML snapshot of the shell won't
  catch it (the break is in the JSON layer). **Resolved ordering:**
  1. Repoint `/old`'s client JS to `/api/memories`.
  2. Add **API-response golden fixtures** (byte-diff `/api/entries/*` vs `/api/memories/*`),
     not just HTML snapshots.
  3. Retire `/api/entries`.
  4. Split files (M1).
  5. Redesign (M2), then delete `/old`.
  Behavior is stabilized before structure moves. Amends Findings 1 + 5.
- **CONFIRMED — dual row renderer.** SSR list + JSON-hydrate would write row markup twice
  (server TS + client JS). **Resolved: HTML fragments over the wire (hypermedia).** Server
  is the only row renderer; SSR initial list, and filter/search fetch a server-rendered
  `<li>` fragment that JS swaps via `innerHTML`. Zero deps. `/api/memories` JSON stays for
  detail/programmatic use. Amends Finding 3.
- **OVERSTATED — "breaking change for agents."** Verified: `mcp-server.ts` uses the service
  directly; zero `fetch('/api/...')` outside web.ts. No in-repo HTTP consumer. Detail→raw
  markdown is safe for in-repo callers; Finding 2 stands. (External tools hitting the local
  server would be affected — low risk for a local-first tool.)

### Open spec gaps to nail during implementation (from outside voice)
- **Derived filters as primary nav.** tier/class/topic are derived from tags; entries with
  missing tags fall to `unknown` and become unfilterable. The left rail must surface an
  `unknown`/`untagged` bucket so nothing is invisible. Validate IA against a REAL store, not
  just the 8-entry fixture.
- **Multi-valued filter semantics.** `EntryClass[]`/`TopicKind[]` are arrays. Define
  AND/OR: within a group (e.g. two topics) = OR; across groups (tier AND topic) = AND. An
  entry with two classes shows under both. Spec this in `listMemories`.
- **`.todos.json` concurrency.** Optimistic UI + agent writes to one JSON file, no locking.
  Writes already use temp-file + rename (atomic), but last-writer-wins can drop a concurrent
  edit. Acceptable for single-user local; note it, don't build locking. → TODO.

## Ship order (REVISED per outside voice — behavior stable before structure)

0. **Repoint `/old` → `/api/memories`** + add API-response golden fixtures. Retire
   `/api/entries` (+ write siblings). Behavior unchanged, verified by API goldens.
1. **Structural split, no visual change** — `web.ts` → router + `api/*` + `derive.ts`
   + `markdown.ts` + `view/*`. Golden HTML snapshot + API goldens both green.
2. **Unify to one design system** — `view/tokens.ts` (flat dark, native fonts),
   `view/shell.ts`, browser-as-home layout, HTML-fragment list rendering, state +
   responsive + a11y specs. Delete `/old`. `/old` fate is now **decided: delete** (resolves
   the Pass 1 / Pass 7 contradiction the outside voice flagged).

## Worktree parallelization

Step 0 + M1 are sequential (both rewrite `web.ts` / the same routes). After the split,
M2 view work parallelizes:
- Lane A: `view/tokens.ts` → `view/shell.ts` (sequential, shared CSS) → list + reader.
- Lane B: `derive.ts` unit tests + `markdown.ts` hardening (independent module).
- Lane C: Tasks panel (touches `api/todos.ts` + a view fragment, independent of list/reader).
Conflict flag: Lanes A and C both touch `view/shell.ts` — merge shell first, then branch.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Outside Voice | Claude subagent | Independent 2nd opinion | 1 | issues_found | 2 confirmed flaws fixed, 1 overstated |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | 8/10 | 3/10 → 8/10, 8 decisions |
| DX Review | `/plan-devex-review` | Developer experience | 0 | — | not run |

- **CROSS-MODEL:** outside voice (Claude subagent) caught the golden-snapshot/sequencing
  flaw and the dual-renderer risk; both fixed. Its "breaking change for agents" claim was
  refuted by code (no in-repo HTTP consumers). codex-spark unsupported on this account;
  gemini quota exhausted.
- **UNRESOLVED:** 0.
- **VERDICT:** ENG + DESIGN CLEARED — ready to implement (Step 0 → M1 → M2).

