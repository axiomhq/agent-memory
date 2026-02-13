# WORKFLOW = DATA ★★

**forces**: you're building a system where agents perform multi-step work
that may be interrupted. a running process is opaque while alive and gone
when it dies. you want workflows to survive interruptions (container
restarts, agent crashes). you also want them inspectable, queryable,
and debuggable as simple data.

**therefore**: a workflow is a record with state, not a running process.
the record describes current phase, accumulated context, and what event
it's waiting for. processes come and go; the record persists.

**intended consequences**:

- ✓ container restarts don't lose work — records rehydrate on boot
- ✓ workflows queryable as data (list, filter, inspect)
- ✓ clear separation: static metadata vs dynamic execution state
- △ requires explicit state machine design

**consider next**: [EXHAUSTIVE STATE MODELING](exhaustive-state-modeling.md),
[HUMAN-FRIENDLY IDENTIFIERS](human-friendly-identifiers.md)

---

## in this codebase

**schema**: `src/schema.ts` — `MemoryEntryMetaSchema` and `JournalQueueEntrySchema`
define the record shapes via arktype.

**memory entries**: stored as markdown files with YAML frontmatter in
`topics/` and `archive/`. each entry has stable `id__XXXXXX` identifier,
usage tracking (`used`, `last_used`), and status lifecycle
(`captured → consolidated → promoted`).

**journal queue**: pending entries in `inbox/*.json`. processed entries
moved to `inbox/.processed/`.

**persistence**: `src/persist/filesystem.ts` — filesystem adapter with
atomic write-rename for crash safety.

```
~/commonplace/01_files/_utilities/agent-memories/
  inbox/                    # journal queue entries (JSON)
    2026-02-13T14-30_amp_abc123.json
    .processed/             # consumed entries
  topics/                   # organized knowledge base (markdown)
    xstate-guard-patterns -- topic__xstate id__a1b2c3.md
  archive/                  # demoted/superseded entries
```
