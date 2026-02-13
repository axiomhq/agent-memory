---
thread: https://ampcode.com/threads/T-019c545f-cffb-7234-ae4a-8aec56fca7af
date: 2026-02-13
participants: bdsqqq, amp
status: design complete, ready for PRD
---

# initial design conversation

## problem

the current memory system (`~/commonplace/01_files/_utilities/agent-memories/`) is a flat bag of date-prefixed markdown files retrieved via `rg`. three failures:
1. retrieval is keyword-dependent — if you don't guess the right keyword, the memory doesn't exist
2. no hot memory — everything requires explicit grep, nothing is always-in-context
3. no hierarchy or progressive disclosure — 28 files today, no navigational signal

## research conducted

### letta code (cloned to ~/www/letta-code)
- context repositories: git-backed memory filesystem with `system/` (hot, always in prompt) and reference dirs (cold, on demand)
- filetree as navigation — folder structure + frontmatter descriptions enable progressive disclosure
- reflection subagent: background process triggered every N turns or on compaction events, reviews conversation history, writes memories to git worktree, merges back
- defrag skill: reorganizes memory into 15-25 focused files with `/` hierarchy
- NO per-file access tracking — promotion is content-based, not usage-based
- key files: `src/agent/subagents/builtin/reflection.md`, `src/skills/builtin/initializing-memory/SKILL.md`, `src/skills/builtin/defragmenting-memory/SKILL.md`

### gilfoyle (~/www/axiom/gilfoyle)
- three-tier memory (personal + org, both with kb/ and journal/)
- `used` counter + `last_used` timestamp in entry metadata — observability at write-time
- `pinned: false` flag for hot-tier marking
- `scripts/mem-doctor` for health checks, `scripts/sleep` for consolidation
- `SKILL.core.md` template pattern for persona overlays

### axi-agent (~/www/axiom/axi-agent/main/features/memory/)
- xstate consolidation machine: `loadJournals → runAgent → parseOutput → writeKbEntries → markConsolidated → commitKnowledgeBase`
- arktype schemas for MemoryEntry with status lifecycle: `captured → consolidated → promoted`
- persistence adapter pattern (interface + filesystem implementation)
- zettelkasten-style consolidation prompt with cross-referencing
- journal capture via amp-sdk `execute()` — fire-and-forget after workflow completion
- key files: `consolidate.ts`, `consolidate-prompt.ts`, `capture-journal.ts`, `persist/filesystem.ts`, `schema.ts`, `service.ts`

## architecture decisions

### four-layer system
1. **signal layer** — per-harness write adapters drop lightweight journal entries into a queue
2. **journal queue** — filesystem directory with standardized schema (harness-agnostic)
3. **consolidation agent** — drains queue, fetches session history via read adapters, reflects, routes to memory tiers
4. **memory filesystem** — tiered storage with AGENTS.md generation

### journal queue schema (standardized contract)
```jsonc
{
  "version": 1,
  "timestamp": "ISO-8601",
  "harness": "amp | cursor | codex | manual",
  "retrieval": {
    "method": "amp-thread | cursor-session | file",
    "threadId": "T-xxx",  // or sessionPath, etc.
  },
  "context": {
    "cwd": "/path/to/project",
    "repo": "github.com/owner/repo"
  }
}
```

### memory filename convention
```
descriptive-title -- topic__x topic__y id__XXXX.md
```
- NO date prefix (not useful for retrieval)
- tags for filtering: `topic__*`, `area__*`
- `id__XXXX` — 4-char stable hash, survives renames
- cross-links use `[[id__XXXX]]`, resolvable via grep

### tiering
- everything lands in **inbox/** first
- consolidation agent processes into organized **topics/** structure
- defrag agent autonomously decides what's hot enough for AGENTS.md inlining (user can review but doesn't need to approve)
- AGENTS.md has auto-generated memory section: hot = full content inlined, warm = file paths listed

### consolidation trigger
- primary: cron/launchd on a schedule
- secondary: manual `memory consolidate` CLI call
- same machine, same binary, either trigger

### storage location
`~/commonplace/01_files/_utilities/agent-memories/` — stays in syncthing-ed commonplace

### harness integration
- LLM invocation is dependency-injectable via config (not hardcoded to amp-sdk or shell)
- axi-agent consumes via git submodule, provides its own actors to xstate machines

## tech stack (matching axi-agent conventions)
- bun runtime
- xstate for state machines (consolidation, defrag)
- arktype for schema validation
- neverthrow for error handling
- oxfmt for formatting
- oxlint for linting
- strict typescript (noUncheckedIndexedAccess, verbatimModuleSyntax, etc.)

## what to extract from axi-agent
- `features/memory/schema.ts` — MemoryEntry, MemoryEntryMeta (adapt ID format)
- `features/memory/persist/index.ts` — MemoryPersistenceAdapter interface
- `features/memory/persist/filesystem.ts` — file-based implementation (adapt paths)
- `features/memory/service.ts` — capture, list, read, updateMeta
- `features/memory/consolidate.ts` — xstate machine (adapt actors)
- `features/memory/consolidate-prompt.ts` — zettelkasten prompt builder
- `features/memory/capture-journal.ts` — journal capture pattern (decouple from amp-sdk)

## what to build new
- journal queue schema + read/write adapters per harness
- defrag xstate machine (reorganize + tier + AGENTS.md generation)
- stable `id__XXXX` hash system for resilient cross-linking
- AGENTS.md generator (hot inlined, warm as paths)
- CLI entrypoint: `memory consolidate`, `memory defrag`, `memory capture`
- launchd plist for cron trigger
- nix flake for installation

## what gilfoyle adds
- `used`/`last_used` counters in entry metadata
- `pinned` flag for explicit hot-tier marking
- `mem-doctor` health check concept
