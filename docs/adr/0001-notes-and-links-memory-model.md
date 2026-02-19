# 1. Notes and Links Memory Model

Date: 2026-02-19

## Status

Proposed

## Context

agent-memory currently models entries as metadata containers: each entry has a JSON header with an `id`, `title`, `tags`, `used` counter, `last_used` timestamp, and `status`. the filename encodes metadata (`descriptive-title -- kw1 kw2 id__XXXXXX.md`), and a `_top-of-mind` filename prefix controls whether an entry is inlined into the consumer's system prompt.

several problems surfaced during the flat-archive refactor:

### usage tracking is unreliable

the `used` counter and `last_used` timestamp only increment when the consumer calls `service.read()`. in practice, agents access memories via `grep`, `cat`, file-read tools, or other operations that bypass the service layer entirely. the counters reflect a tiny fraction of actual reads, making them a misleading signal for the defrag prompt's tiering decisions.

the defrag prompt currently renders these as `used: 5, last_used: 2024-01-15T10:30:00Z` per entry, and instructs the LLM that they "inform but don't dictate tiering." in practice, the LLM is reasoning over junk data.

### top-of-mind is encoded in the wrong place

the `_top-of-mind` filename prefix is a property of the entry, but it should be a property of the *index* — which entries the system prompt references. an entry doesn't know or care if it's "top of mind." something else (an index note, a generated section) decides what to include. encoding this in the filename means the file moves/renames when its promotion status changes, adding noise to git diffs.

### entries lack relationships

the current model is flat: entries exist in isolation. the defrag prompt does content analysis to detect duplicates and merge candidates, but there's no structural way for entries to reference each other. agents build up knowledge about people, repos, projects, and decisions — entities that naturally reference each other. without links, an agent can't express "igor made this decision about the query builder for the console because of the structured format constraint" as a relationship between entities.

### the filename encodes too much

the filename `descriptive-title -- kw1 kw2 id__XXXXXX.md` is a derived view of the JSON metadata. when defrag renames or retags an entry, the filename changes. this creates unnecessary file churn in git and complicates the persistence layer.

## Decision

adopt a **notes-and-links** model. the core primitive is a **note** — a markdown file with an identity, content, and links to other notes. structure emerges from link topology, not from tiers, folders, or metadata flags.

### core principles

**1. notes are objects, not containers.**

a note represents a durable piece of knowledge — a person, a repo, a pattern, a decision. it accumulates context over time through edits and inbound links.

inspired by [evergreen notes](https://stephango.com/evergreen-notes) (steph ango / andy matuschak): "evergreen notes turn ideas into objects that you can manipulate... you don't need to hold them all in your head at the same time."

**2. links are the structure.**

notes reference each other via `[[links]]`. the link graph encodes relationships: igor → console, console → app.axiom.co, query-builder → structured-format. no folders-as-categories, no tier flags. a note's importance is emergent from its link topology — heavily linked notes are de facto knowledge; unlinked notes are de facto ephemeral.

inspired by [steph ango's vault](https://stephango.com/vault): "I use internal links profusely... this heavy linking style becomes more useful as time goes on, because I can trace how ideas emerged, and the branching paths these ideas created."

**3. the filename IS the metadata.**

following the [commonplace convention](~/commonplace/README.md): `DATE title -- tag1 tag2.md`. no separate JSON metadata header. tags are filename-level filtering flags. the body is the content. identity comes from a stable ID embedded in the note (format TBD — could be frontmatter, could be part of the filename).

each note should be concise enough to compose with others. per [steph ango](https://stephango.com/concise): "concise explanations accelerate progress. explain ideas in simple terms, strongly and clearly, so that they can be rebutted, remixed, reworked — or built upon."

**4. top-of-mind is an index note, not a property.**

a special index note links to the entries that should be inlined in the consumer's system prompt. defrag updates the index, not the entries. entries don't know they're "top of mind."

this eliminates:
- `_top-of-mind` filename prefixes
- `setTopOfMind()` / `isTopOfMindFilename()` helpers
- the conceptual confusion of "am I important?" being baked into the entry itself

**5. usage tracking is removed.**

the `used` counter and `last_used` timestamp are deleted from the schema. the signal for "is this note alive?" is:

- **link topology** — inbound links from other notes
- **recency** — `createdAt`/`updatedAt` or git history
- **content relevance** — LLM judgment during defrag

access counting was unreliable (agents bypass `service.read()`) and unnecessary — letta's memory system, which has shipped to production across three generations, never implemented usage tracking (see research section below).

**6. defrag operates on the graph.**

the defrag machine reads all notes + their link structure. the machine can deterministically check for:

- orphan notes (no inbound links, old)
- broken links (target doesn't exist)
- structural issues (cycles, overly dense clusters)

the LLM decides *what* to reorganize (merge, split, rename, archive). the machine validates the result is structurally sound. link topology informs aggressiveness: heavily-linked notes are handled with care; unlinked, old notes are candidates for archival.

**7. safe mutation tools.**

because links can break if files are moved/renamed carelessly, the system should provide safe mutation operations (e.g., a `move` command that updates all inbound links) rather than relying on raw filesystem operations. consumers may restrict agents from using `mv` directly on memory files.

### what this replaces

| before | after |
|--------|-------|
| JSON metadata header in HTML comment | frontmatter or filename-only metadata |
| `_top-of-mind` filename prefix | index note with `[[links]]` |
| `used` counter | removed — link density is the liveness signal |
| `last_used` timestamp | removed — `createdAt`/git history for recency |
| `setTopOfMind()` / `isTopOfMindFilename()` | removed — index note updated by defrag |
| `service.read()` increments usage | removed — reads don't mutate state |
| entries exist in isolation | `[[id]]` links encode relationships |

### lifecycle

```
capture (session facts)
    → consolidation (synthesize into notes, create links)
    → defrag (reorganize notes, update links, update index note)
    → system prompt generation (read index, inline linked notes)
    → git commit + push
```

the distinction between "ephemeral facts" and "durable knowledge" is not a declared tier — it's emergent from the graph. notes with many inbound links, recent edits, and rich content are de facto knowledge. notes with no links, stale content, and narrow scope are de facto ephemeral, and defrag can treat them more aggressively.

## Research: how Letta handles memory reorganization

[Letta](https://www.letta.com/) (formerly MemGPT) is the most prominent system doing agent memory at scale. their approach evolved through three generations, none of which use usage counters:

**gen 1 — MemGPT (2023):** agent manages its own memory inline during conversation via `core_memory_replace()` / `core_memory_append()`. memory blocks with character limits. problem: memory management bundled with conversation makes the agent slower, and incremental edits degrade quality over time. ([source](https://www.letta.com/blog/sleep-time-compute))

**gen 2 — sleep-time compute (apr 2025):** dedicated background agent rewrites memory during idle time. the primary agent loses write access to its own core memory; a sleep-time agent handles reorganization asynchronously. the signal for reorganization is content quality, not access frequency. key quote: "memory formation in MemGPT is incremental, so memories may become messy and disorganized over time. sleep-time agents can continuously improve their learned context to generate clean, concise, and detailed memories." ([source](https://www.letta.com/blog/sleep-time-compute))

**gen 3 — context repositories (feb 2026):** git-backed filesystem as memory. three memory skills: ([source](https://www.letta.com/blog/context-repositories))

- **memory reflection** — background process reviews conversation history, persists to git repo
- **memory defragmentation** — "over long-horizon use, memories inevitably become less organized. the defragmentation skill backs up the agent's memory filesystem, then launches a subagent that reorganizes files, splitting large files, merging duplicates, and restructuring into a clean hierarchy of 15–25 focused files."
- **progressive disclosure** — `system/` directory pins files to context. agents move files in/out of `system/` to control what's always loaded.

letta's defrag signals: content analysis, structural health, git history for temporal context, agent judgment. no usage counters, no access frequency tracking.

key architectural difference: letta's defrag destroys and rewrites files freely — identity doesn't survive between defrag runs. our system preserves identity via stable IDs because notes link to each other and links must survive reorganization. letta doesn't need IDs because their memories don't reference each other.

additional letta references consulted:
- [agent memory](https://www.letta.com/blog/agent-memory) — overview of memory types and techniques
- [guide to context engineering](https://www.letta.com/blog/guide-to-context-engineering) — LLM OS analogy, kernel vs user context
- [memory blocks](https://www.letta.com/blog/memory-blocks) — memory block abstraction, shared blocks, sleep-time agents
- [stateful agents](https://www.letta.com/blog/stateful-agents) — the case for persistent memory, context pollution from naive RAG

## Design influences

- **[evergreen notes](https://stephango.com/evergreen-notes)** (steph ango / andy matuschak) — notes as durable objects with titles that distill ideas. "you don't need to hold them all in your head at the same time." the note IS the idea, not a container for metadata about the idea.

- **[steph ango's vault](https://stephango.com/vault)** — flat storage, link-heavy, emergent structure. "I use very few folders... my notes are primarily organized using categories [and links]." avoids folders-as-categories because notes belong to multiple areas. "I use internal links profusely... unresolved links are important because they are breadcrumbs for future connections between things."

- **[concise explanations](https://stephango.com/concise)** (steph ango) — "concise explanations accelerate progress. explain ideas in simple terms, strongly and clearly, so that they can be rebutted, remixed, reworked — or built upon." applies to note content: each note should be concise enough to combine with others.

- **commonplace convention** (`~/commonplace/README.md`) — flat storage with `DATE name -- tag1 tag2.ext` filenames. filename tags as filtering flags. retrieval via search, not navigation. "folder hierarchies force a file into one location. a document about health finances belongs in both 'health' and 'finance' — folders can't express that."

## Consequences

- ✓ usage tracking removed — eliminates unreliable `used`/`last_used` fields and the lie they tell
- ✓ entries can reference each other — relationships between people, repos, decisions are structural, not implicit
- ✓ top-of-mind is an index, not a flag — cleaner separation of concerns, less filename churn
- ✓ defrag gets graph-aware signals — link density, orphan detection, broken link checking are deterministic
- ✓ simpler schema — fewer fields, no JSON header, filename carries its own weight
- ✓ consistent with commonplace conventions — agent memory and personal notes follow the same model
- △ stable IDs are required — links must survive renames, so entries need immutable identifiers (format TBD)
- △ link maintenance overhead — safe mutation tools needed to prevent broken links
- △ migration required — existing entries need IDs, links, and format conversion
- △ defrag prompt needs rework — remove `used`/`last_used` references, add link topology as input signal
- △ consolidation must create links — when synthesizing session facts into notes, relevant cross-references should be inserted
