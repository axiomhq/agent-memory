# agent-memory

a memory system for AI coding agents. works with any harness — amp, cursor, codex, or manual CLI.

the problem it solves: your agent "forgets" everything between threads. you could grep a folder of notes, but that requires knowing the right keyword. nothing is always-in-context. everything is a flat bag of files with no navigational signal.

agent-memory fixes this with a four-layer pipeline:

```
signal → journal queue → consolidation → tiered memory filesystem
                                    ↓
                              AGENTS.md generation
```

the result: your agent starts each thread with relevant context already in AGENTS.md. no grep required.

## how it works

1. **capture**: your agent harness drops a journal entry into `inbox/` after each session
2. **consolidate**: an LLM reflects on the session, extracts knowledge, writes to `topics/`
3. **defrag**: periodically reorganizes memory — merges duplicates, splits overgrown entries, assigns hot/warm tiers
4. **disclose**: generates AGENTS.md with hot memory inlined, warm memory listed, cold memory omitted

## installation

### as a nix flake

```nix
# flake.nix
{
  inputs.agent-memory.url = "github:axiomhq/agent-memory";
  
  outputs = { self, agent-memory, ... }: {
    # your config
  };
}
```

### as a git submodule

```bash
git submodule add https://github.com/axiomhq/agent-memory
```

### standalone

```bash
git clone https://github.com/axiomhq/agent-memory
cd agent-memory
bun install
```

## CLI usage

```bash
# capture a journal entry
bun run src/cli/index.ts capture --title "learned xstate guards" --body "guards return boolean, not truthy" --tags "topic__xstate"

# list memory entries
bun run src/cli/index.ts list

# read an entry (increments used counter)
bun run src/cli/index.ts read id__abc123

# run consolidation
bun run src/cli/index.ts consolidate

# run defrag
bun run src/cli/index.ts defrag

# generate AGENTS.md
bun run src/cli/index.ts generate-agents-md --target ~/.config/amp/AGENTS.md

# health check
bun run src/cli/index.ts doctor
```

## architecture

```
src/
├── schema.ts           # arktype schemas for journal + memory entries
├── service.ts          # high-level API with usage tracking
├── config.ts           # zero-config with sensible defaults
├── id.ts               # 6-char base58 stable ID generation
├── format.ts           # markdown serialization
├── journal.ts          # queue operations
├── persist/
│   ├── index.ts        # adapter interface
│   └── filesystem.ts   # file-based implementation
├── machines/
│   ├── consolidate.ts  # xstate consolidation machine
│   └── defrag.ts       # xstate defrag machine
├── prompts/
│   ├── consolidate.ts  # zettelkasten prompt builder
│   └── defrag.ts       # reorganization prompt
├── adapters/
│   ├── index.ts        # adapter interfaces
│   ├── amp.ts          # amp harness adapter
│   └── shell.ts        # generic LLM shell adapter
├── agents-md/
│   └── generator.ts    # AGENTS.md section generator
└── cli/                # CLI commands
```

## pattern language

the system is built on 13 patterns extracted from axi-agent. see `docs/pattern-language/` for the full treatment.

key patterns:

- **WORKFLOW = DATA**: a workflow is a record with state, not a running process. container restarts don't lose work — records rehydrate on boot.
- **INJECT AT THE BOUNDARY**: all I/O via adapter interfaces. machines call adapters; adapters call external systems. testable in isolation.
- **EXHAUSTIVE STATE MODELING**: every state and transition explicitly modeled. impossible states are compile errors.

## storage layout

```
~/commonplace/01_files/_utilities/agent-memories/
├── inbox/                     # journal queue entries (JSON)
│   ├── 2026-02-13T14-30_amp_abc123.json
│   └── .processed/            # consumed entries
├── topics/                    # organized knowledge base (markdown)
│   ├── xstate-guard-patterns -- topic__xstate id__a1b2c3.md
│   └── neverthrow-error-tags -- topic__neverthrow id__c3d4e5.md
└── archive/                   # demoted/superseded entries
```

## cross-linking

entries use stable `id__XXXXXX` identifiers. cross-links use `[[id__abc123]]` syntax, resolved via grep. the ID survives renames and reorganization.

## configuration

zero-config by default. optionally create `memory.config.json`:

```json
{
  "storage": {
    "root": "~/commonplace/01_files/_utilities/agent-memories/",
    "autoCommit": true
  },
  "llm": {
    "command": "amp agent run"
  },
  "agentsMd": {
    "targets": ["~/.config/amp/AGENTS.md"]
  }
}
```

## testing

```bash
bun test                    # run all tests
bun test test/integration.test.ts  # end-to-end tests
bun run typecheck           # type check
```

214 tests covering core modules, machines, adapters, CLI, and integration.

## consumption modes

1. **git submodule** (axi-agent): import from `src/`, provide your own adapters via `machine.provide()`
2. **nix flake** (personal dotfiles): builds CLI binary, installs launchd/systemd timers

## why this exists

the original system was a flat folder of date-prefixed markdown files. three failures:

1. **keyword-dependent retrieval**: if you don't guess the right keyword, the memory doesn't exist
2. **no hot memory**: nothing is always-in-context; everything requires explicit grep
3. **no progressive disclosure**: 28+ files, no navigational signal, no tiering

agent-memory replaces this with structured consolidation and tiered disclosure. your agent starts with context, not a grep command.

## credits

extracted from [axi-agent](https://github.com/axiomhq/axi-agent). pattern language informed by hard-won lessons in agent memory management.

ID format follows [unkey's UUID UX principles](https://www.unkey.com/blog/uuid-ux).
