# PRD: agent-memory

## Introduction

a standalone, harness-agnostic memory system for AI coding agents. extracts and generalizes the memory subsystem from axi-agent into a reusable package that any agent harness (amp, cursor, codex, manual) can write to and read from.

the current system (`~/commonplace/01_files/_utilities/agent-memories/`) is a flat bag of date-prefixed markdown files retrieved via `rg`. three failures:
1. **keyword-dependent retrieval** — if you don't guess the right keyword, the memory doesn't exist
2. **no hot memory** — nothing is always-in-context; everything requires explicit grep
3. **no progressive disclosure** — 28+ files, no navigational signal, no tiering

agent-memory replaces this with a four-layer pipeline: signal → journal queue → consolidation → tiered memory filesystem, with AGENTS.md generation for automatic hot/warm/cold disclosure.

consumed as a **git submodule** by axi-agent and as a **nix flake** by personal dotfiles.

## Goals

- decouple memory from axi-agent so it works with any harness (amp, cursor, codex, manual CLI)
- provide automatic hot-memory surfacing via generated AGENTS.md sections
- preserve the axi-agent consolidation architecture (xstate machines, arktype schemas, neverthrow errors, adapter injection)
- support both cron-triggered and manual consolidation/defrag
- maintain the commonplace storage location (`~/commonplace/01_files/_utilities/agent-memories/`) for syncthing compatibility
- expose a CLI that works standalone (`memory capture`, `memory consolidate`, `memory defrag`)
- enable cross-linking between memory entries via stable `id__XXXX` hashes that survive renames

## User Stories

### US-001: Journal Queue Schema & Writer
**Description:** As an agent harness adapter, I want to drop a lightweight journal entry into a queue directory so that consolidation can process it later without needing to know about my harness.

**Acceptance Criteria:**
- [ ] `JournalQueueEntry` arktype schema validates the standardized contract:
  ```jsonc
  {
    "version": 1,
    "timestamp": "ISO-8601",
    "harness": "amp | cursor | codex | manual",
    "retrieval": {
      "method": "amp-thread | cursor-session | file",
      "threadId": "T-xxx"  // or sessionPath, etc — polymorphic per method
    },
    "context": {
      "cwd": "/path/to/project",
      "repo": "github.com/owner/repo"
    }
  }
  ```
- [ ] `writeJournalEntry(entry)` writes validated JSON to `inbox/` as `{timestamp}_{harness}_{nanoid}.json`
- [ ] `listPendingEntries()` returns unprocessed entries sorted by timestamp
- [ ] `markProcessed(entryId)` moves entry to `inbox/.processed/`
- [ ] typecheck passes

### US-002: Memory Entry Schema with Stable IDs
**Description:** As a memory system consumer, I want memory entries to have stable identifiers that survive renames and reorganization so that cross-links don't break.

**Acceptance Criteria:**
- [ ] Memory filename convention: `descriptive-title -- topic__x topic__y id__XXXXXX.md`
- [ ] `id__XXXXXX` is a 6-character stable hash derived from content + creation timestamp (base58, per [unkey's UUID UX principles](https://www.unkey.com/blog/uuid-ux))
- [ ] NO date prefix in filenames (not useful for retrieval — decided in design conversation)
- [ ] Cross-links use `[[id__XXXXXX]]` syntax, resolvable via grep
- [ ] `MemoryEntryMeta` arktype schema includes fields from axi-agent PLUS gilfoyle additions:
  - `id` (id__XXXXXX format)
  - `title`, `tags` (topic__*, area__*)
  - `status`: `captured → consolidated → promoted`
  - `used: number` — read counter (gilfoyle pattern)
  - `last_used: string` — ISO-8601 timestamp of last access
  - `pinned: boolean` — explicit hot-tier marking
  - `createdAt`, `updatedAt` (epoch ms)
  - `sources` (harness, threadId, repo, cwd)
- [ ] typecheck passes

### US-003: Persistence Adapter Interface
**Description:** As a developer, I need a clean persistence boundary so that storage can be filesystem-based today and swappable later.

**Acceptance Criteria:**
- [ ] `MemoryPersistenceAdapter` interface extracted from axi-agent pattern:
  - `list(filter?)` → `ResultAsync<MemoryEntryMeta[], MemoryPersistenceError>`
  - `read(id)` → `ResultAsync<MemoryEntry, MemoryPersistenceError>`
  - `write(entry)` → `ResultAsync<void, MemoryPersistenceError>`
  - `delete(id)` → `ResultAsync<void, MemoryPersistenceError>`
- [ ] `MemoryPersistenceError` is a tagged union (neverthrow pattern)
- [ ] Filesystem implementation adapted from axi-agent's `persist/filesystem.ts`
  - uses new filename convention (descriptive title + id__XXXX)
  - directory layout: `inbox/`, `topics/`, `archive/`
  - storage root configurable, defaults to `~/commonplace/01_files/_utilities/agent-memories/`
- [ ] `MemoryScope` simplified: no org tier (personal-only for now, org is a non-goal)
- [ ] typecheck passes

### US-004: Memory Service
**Description:** As a CLI or harness adapter, I want a high-level API over the persistence adapter for capture, list, read, and update operations.

**Acceptance Criteria:**
- [ ] `createMemoryService(adapter)` returns a `MemoryService` with methods:
  - `capture(input)` — creates entry, returns `ResultAsync<MemoryEntry, ...>`
  - `list(filter?)` — lists entry metadata
  - `read(id)` — reads full entry, increments `used` counter and updates `last_used`
  - `updateMeta(id, patch)` — read-modify-write for metadata fields
  - `updateBody(id, body)` — read-modify-write for body
  - `remove(id)` — deletes entry
- [ ] adapted from axi-agent's `service.ts`, with `used`/`last_used` auto-increment on read
- [ ] typecheck passes

### US-005: Consolidation Machine
**Description:** As a cron job or CLI user, I want to drain the journal queue, invoke an LLM to reflect on session history, and route extracted knowledge into the memory filesystem.

**Acceptance Criteria:**
- [ ] xstate machine with states: `loadQueue → fetchHistory → runAgent → parseOutput → writeEntries → markProcessed → commitChanges → completed | failed`
- [ ] adapted from axi-agent's `consolidate.ts` — same adapter-injection pattern (`machine.provide()`)
- [ ] adapters interface (`ConsolidateAdapters`) includes:
  - `loadQueue(limit)` — reads pending journal queue entries
  - `fetchHistory(retrieval)` — per-harness: calls amp read_thread, reads cursor session file, reads inline file content
  - `executeAgent(prompt)` — pipes prompt to configured shell command, returns response
  - `writeKbEntry(input)` — writes to topics/ via persistence adapter
  - `markProcessed(entryId)` — moves queue entry to processed
- [ ] consolidation prompt preserved from axi-agent (zettelkasten decomposition, cross-referencing, tags)
- [ ] `parseConsolidationOutput` and `resolveIntraBatchLinks` extracted from axi-agent
- [ ] typecheck passes

### US-006: Defrag Machine
**Description:** As a periodic maintenance process, I want to reorganize the memory filesystem — merging duplicates, splitting overgrown entries, updating tiers, and regenerating AGENTS.md.

**Acceptance Criteria:**
- [ ] xstate machine with states: `scanEntries → analyzeStructure → runAgent → applyChanges → generateAgentsMd → commitChanges → completed | failed`
- [ ] the defrag agent receives the full corpus + usage metadata (`used`, `last_used`, `pinned`) and qualitatively decides:
  - what earns hot-tier (inlined in AGENTS.md) — agent judgment, not thresholds
  - what to merge, split, rename, or archive
  - file count targets: 15-25 focused files (letta pattern)
  - max ~40 lines per file (split if larger)
  - duplicate/overlapping content detection
- [ ] adapter-injected LLM invocation (pipes prompt to configured shell command)
- [ ] typecheck passes

### US-007: AGENTS.md Generator
**Description:** As an agent starting a session, I want relevant memory automatically injected into my context via AGENTS.md so that I don't need to grep for everything.

**Acceptance Criteria:**
- [ ] generates an AGENTS.md section with three tiers:
  - **hot** (agent qualitatively decides what earns its place, informed by pinned flag + usage data): full content inlined in AGENTS.md
  - **warm** (relevant but not top-tier): file paths listed with one-line descriptions
  - **cold** (everything else): omitted, discoverable via `memory list` or grep
- [ ] tiering decisions are made by the defrag agent (LLM-driven, letta-style), not by hard thresholds. `used`/`last_used` are inputs to the agent, not programmatic cutoffs
- [ ] output is a markdown string that can be written to any AGENTS.md location
- [ ] supports writing to multiple AGENTS.md targets:
  - `~/.config/amp/AGENTS.md` (global amp context)
  - project-local AGENTS.md files (when repo-scoped memories exist)
- [ ] idempotent: re-running replaces the memory section, preserves user-written content outside the managed section markers (`<!-- agent-memory:start -->` / `<!-- agent-memory:end -->`)
- [ ] typecheck passes

### US-008: Harness Adapters — Amp (First-Class)
**Description:** As an amp user, I want memory capture and retrieval to work seamlessly with amp's thread system.

**Acceptance Criteria:**
- [ ] **write adapter**: after-session hook that creates a journal queue entry with `harness: "amp"`, `retrieval.method: "amp-thread"`, `retrieval.threadId: "T-xxx"`
  - implementable as an amp skill that calls the CLI
  - does NOT depend on `@sourcegraph/amp-sdk` — uses CLI or direct file write
- [ ] **read adapter**: `fetchHistory("amp-thread", threadId)` invokes `amp thread read T-xxx` CLI command to retrieve session content for consolidation
- [ ] adapter is a separate module that can be omitted when amp isn't available
- [ ] typecheck passes

### US-009: CLI Entrypoints
**Description:** As a user or cron job, I want CLI commands to capture, consolidate, defrag, and inspect memory.

**Acceptance Criteria:**
- [ ] `memory capture --title "..." --body "..." [--tags "..."] [--harness amp] [--thread-id T-xxx]`
  - writes a journal queue entry
- [ ] `memory consolidate [--limit N]`
  - drains queue, runs consolidation machine
  - prints summary: N entries processed, M kb entries written
- [ ] `memory defrag`
  - runs defrag machine, regenerates AGENTS.md
  - prints summary: files merged/split/re-tiered
- [ ] `memory list [--status captured|consolidated|promoted] [--query "..."]`
  - lists memory entries with metadata
- [ ] `memory read <id>`
  - prints full entry, increments used counter
- [ ] `memory doctor`
  - health check: orphaned cross-links, oversized files, stale entries, schema validation
- [ ] `memory generate-agents-md [--target ~/.config/amp/AGENTS.md]`
  - runs AGENTS.md generation standalone
- [ ] all commands exit 0 on success, non-zero on failure with structured error output
- [ ] CLI uses bun as runtime (`#!/usr/bin/env bun`)
- [ ] typecheck passes

### US-010: Launchd Cron Setup
**Description:** As a macOS user, I want consolidation and defrag to run automatically on a schedule.

**Acceptance Criteria:**
- [ ] launchd plist: `com.agent-memory.consolidate.plist`
  - runs `memory consolidate` on configurable interval (default: every 2 hours)
  - `StandardOutPath` and `StandardErrorPath` for log inspection
  - `KeepAlive: false` (run and exit, not a daemon)
- [ ] launchd plist: `com.agent-memory.defrag.plist`
  - runs `memory defrag` on configurable interval (default: daily)
- [ ] `memory install-cron` CLI command that symlinks plists to `~/Library/LaunchAgents/` and loads them
- [ ] `memory uninstall-cron` to unload and remove
- [ ] typecheck passes (for the CLI commands; plists are XML)

### US-011: Nix Flake
**Description:** As a nix user, I want to install agent-memory via my dotfiles flake.

**Acceptance Criteria:**
- [ ] `flake.nix` at repo root with:
  - `packages.default` — builds the CLI binary
  - `overlays.default` — for composition into other flakes
- [ ] darwin module that installs launchd plists
- [ ] linux module that installs systemd timers (equivalent to launchd)
- [ ] `devShells.default` with bun, oxfmt, oxlint, typescript
- [ ] typecheck passes (for the bun source)

### US-012: Configuration System
**Description:** As a user, I want to configure storage paths, LLM provider, tiering thresholds, and schedule without editing source code.

**Acceptance Criteria:**
- [ ] `memory.config.json` (or `memory.config.ts` for type safety) with arktype-validated schema:
  ```jsonc
  {
    "storage": {
      "root": "~/commonplace/01_files/_utilities/agent-memories/",
      "autoCommit": true,  // git auto-commit on write
      "commitHook": "git commit --trailer 'Thread-Id: {threadId}'"  // template
    },
    "llm": {
      "command": "amp agent run",  // shell command that accepts prompt on stdin
      "presets": {  // built-in presets users can reference by name
        "amp": "amp agent run",
        "ollama": "ollama run llama3"
      }
    },
    "schedule": {
      "consolidateIntervalHours": 2,
      "defragIntervalHours": 24
    },
    "agentsMd": {
      "targets": ["~/.config/amp/AGENTS.md"]
    }
  }
  ```
- [ ] config file searched in: `./memory.config.json`, `~/.config/agent-memory/config.json`
- [ ] all values have sensible defaults (zero-config works)
- [ ] typecheck passes

## Functional Requirements

- FR-1: journal queue entries are validated against arktype schema at write time; malformed entries are rejected with structured errors
- FR-2: memory entry IDs use `id__XXXXXX` format (6-char base58 hash); generated deterministically from title + createdAt timestamp
- FR-3: cross-links use `[[id__XXXXXX]]` syntax; the persistence adapter resolves these to file paths via grep
- FR-4: the consolidation machine is pure xstate — all I/O injected via `machine.provide()`. no direct imports of amp-sdk, fs, or shell
- FR-5: the defrag machine is pure xstate — same injection pattern as consolidation
- FR-6: LLM invocation is shell-command-based: agent-memory produces a prompt, the user's configured command pipes it to their LLM. presets provided for common setups (amp, etc.) but no compiled-in LLM dependency
- FR-7: AGENTS.md generation uses sentinel comments (`<!-- agent-memory:start -->` / `<!-- agent-memory:end -->`) to replace only its managed section
- FR-8: the `used` counter and `last_used` timestamp update atomically on every `read()` call
- FR-9: file writes use atomic write-rename (write to `.tmp`, rename into place) — preserving axi-agent's crash-safety pattern
- FR-10: git auto-commit is a configurable adapter hook (e.g., attribute threadId to commit message). the machines themselves don't know about git — the persistence adapter's post-write hook handles it
- FR-11: the repo is consumable both as a git submodule (for axi-agent) and as a standalone nix flake (for dotfiles)
- FR-12: all error types are tagged unions using neverthrow's `ResultAsync` — no thrown exceptions at public API boundaries
- FR-13: the filesystem adapter reads memory entries from markdown files with YAML frontmatter (preserving the `serializeMemoryMarkdown`/`parseMemoryMarkdown` pattern from axi-agent)

## Non-Goals

- **org-tier / team memory**: personal-only for v1. org support can layer on later using the same adapter interface
- **vector/embedding-based retrieval**: the system uses keyword/tag retrieval + AGENTS.md hot injection. semantic search is a future concern
- **real-time sync**: memory folder is excluded from syncthing; git is the sync mechanism
- **GUI**: CLI-only interface
- **multi-user concurrency**: single-caller CLI scripts. no locking, no conflict resolution beyond atomic writes
- **windows support**: macOS (launchd) and linux (systemd) only. nix handles both
- **cursor/codex harness adapters**: amp is first-class. other harness adapters are documented extension points but not implemented in v1

## Technical Considerations

### Tech Stack (matching axi-agent conventions)
- **runtime**: bun
- **state machines**: xstate v5
- **schema validation**: arktype v2
- **error handling**: neverthrow (ResultAsync, tagged union errors)
- **formatting**: oxfmt
- **linting**: oxlint + eslint
- **typescript**: strict mode — `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noImplicitOverride`, `isolatedModules`

### Extraction from axi-agent
these files are extracted and adapted (not copied verbatim):
| axi-agent file | agent-memory equivalent | changes |
|---|---|---|
| `schema.ts` | `src/schema.ts` | new ID format (id__XXXXXX), add used/last_used/pinned, drop org tier |
| `persist/index.ts` | `src/persist/index.ts` | simplified MemoryScope (no org), same interface shape |
| `persist/filesystem.ts` | `src/persist/filesystem.ts` | new filename convention, new directory layout, configurable root |
| `service.ts` | `src/service.ts` | add used/last_used auto-increment on read |
| `consolidate.ts` | `src/machines/consolidate.ts` | adapt to journal queue input (not direct journal entries) |
| `consolidate-prompt.ts` | `src/prompts/consolidate.ts` | same zettelkasten prompt, extracted cleanly |
| `consolidate-adapters.ts` | `src/adapters/consolidate.ts` | decouple from amp-sdk, make LLM injectable |
| `capture-journal.ts` | `src/adapters/amp.ts` | decouple from amp-sdk execute(), use CLI or file write |

### Directory Structure
```
agent-memory/
├── src/
│   ├── schema.ts              # arktype schemas (journal queue + memory entry)
│   ├── service.ts             # high-level memory service API
│   ├── config.ts              # configuration loading + validation
│   ├── id.ts                  # id__XXXX hash generation
│   ├── format.ts              # markdown serialization/parsing
│   ├── persist/
│   │   ├── index.ts           # adapter interface
│   │   └── filesystem.ts      # file-based implementation
│   ├── machines/
│   │   ├── consolidate.ts     # consolidation xstate machine
│   │   └── defrag.ts          # defrag xstate machine
│   ├── prompts/
│   │   ├── consolidate.ts     # zettelkasten consolidation prompt
│   │   └── defrag.ts          # defrag/reorganization prompt
│   ├── adapters/
│   │   ├── index.ts           # adapter interfaces
│   │   ├── amp.ts             # amp harness adapter
│   │   └── shell.ts           # generic shell-command LLM adapter
│   ├── agents-md/
│   │   └── generator.ts       # AGENTS.md section generator
│   └── cli/
│       ├── index.ts           # CLI entrypoint + command router
│       ├── capture.ts
│       ├── consolidate.ts
│       ├── defrag.ts
│       ├── list.ts
│       ├── read.ts
│       ├── doctor.ts
│       └── generate-agents-md.ts
├── launchd/
│   ├── com.agent-memory.consolidate.plist
│   └── com.agent-memory.defrag.plist
├── flake.nix
├── flake.lock
├── tsconfig.json
├── package.json
├── biome.json                 # or oxlint config
├── AGENTS.md
├── _papertrail/
│   └── 2026-02-13 initial design conversation.md
└── tasks/
    └── prd-agent-memory.md
```

### Consumption Modes
1. **git submodule** (axi-agent): axi-agent imports from `src/`, provides its own xstate actors via `machine.provide()`, wires its own amp-sdk-based adapters
2. **nix flake** (personal dotfiles): builds CLI binary, installs launchd/systemd timers, manages AGENTS.md for `~/.config/amp/AGENTS.md`

### Memory Filesystem Layout (at runtime)
```
~/commonplace/01_files/_utilities/agent-memories/
├── inbox/                     # journal queue entries (JSON)
│   ├── 2026-02-13T14-30_amp_abc123.json
│   └── .processed/            # consumed entries
├── topics/                    # organized knowledge base (markdown)
│   ├── xstate-guard-patterns -- topic__xstate topic__patterns id__a1b2c3.md
│   ├── neverthrow-error-tags -- topic__neverthrow topic__errors id__c3d4e5.md
│   └── bun-test-mocking -- topic__bun topic__testing id__e5f6g7.md
└── archive/                   # demoted/superseded entries
```

## Success Metrics

- agent sessions start with relevant hot memory in AGENTS.md without manual grep
- consolidation processes journal queue entries within the configured interval (default 2h)
- cross-links between memory entries resolve correctly after defrag renames
- axi-agent can consume agent-memory as a submodule with zero changes to its existing consolidation flow (only adapter rewiring)
- `memory doctor` reports zero orphaned links and zero schema violations on a healthy corpus
- the CLI works standalone without any agent harness installed

## Resolved Questions

1. **hash length**: 6-char base58 (`id__XXXXXX`, ~38B combinations). per [unkey's UUID UX](https://www.unkey.com/blog/uuid-ux), short + org-scoped is fine. org prefix handles any theoretical collisions
2. **LLM provider**: shell-command. agent-memory produces a prompt, user's configured command consumes it via stdin. presets for common setups (amp, ollama, etc.)
3. **AGENTS.md tiering**: no hard thresholds. the defrag agent qualitatively decides what earns hot-tier, informed by `used`/`last_used`/`pinned`. letta-style agent judgment
4. **git commits**: configurable adapter hook in `memory.config.json`. `autoCommit: true` + `commitHook` template. commonplace is NOT a git repo; memory folder is its own repo, excluded from syncthing
5. **defrag frequency**: daily. corpus is small (just text), will increase frequency during testing
6. **axi-agent migration**: deferred. one-time migration script when needed — it's just a script

## Open Questions

1. **commit hook template syntax**: deferred. will reference letta's blog posts for prior art on templating conventions
