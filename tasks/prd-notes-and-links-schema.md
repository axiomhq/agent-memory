# PRD: Notes and Links — Phase 1: Schema

## Introduction

remodel `agent-memory` from metadata-containers to notes-and-links. phase 1 covers the foundation: schema changes, format changes, link parsing, and migration from the old format.

this is the first of three phases defined in [ADR 0001](../docs/adr/0001-notes-and-links-memory-model.md):
1. **schema** (this PRD) — new entry format, link syntax, remove usage tracking, migration
2. **defrag** (future) — graph-aware defrag, link topology as input signal
3. **index note** (future) — replace `_top-of-mind` with an index note, AGENTS.md generation from index

### the new model

a memory entry is a plain markdown file. no frontmatter, no JSON header, no metadata layer. everything is derived:

| field | source |
|-------|--------|
| `id` | filename (`... id__XXXXXX.md`) |
| `title` | `# heading` in the markdown body |
| `tags` | `#tag` syntax inline in the body |
| `createdAt` | git history (`git log --follow --diff-filter=A`) |
| `updatedAt` | git history (`git log -1`) |
| status | directory location (index vs archive) |
| links | `[[id__XXXXXX\|display text]]` in the body |

example (filename: `igor-fullstack-developer id__Ab3xYz.md`):
```markdown
# Igor — fullstack developer, design expertise

#people #work

igor is a fullstack developer with deep expertise in design.
he works on the [[id__Kf9mNp|console app]] at axiom.

see also: [[id__Qw2vBc|query builder decisions]]
```

### what's changing

- remove `used`, `last_used`, `pinned` from the schema
- remove `title`, `id`, `tags`, `status`, `createdAt`, `updatedAt` from stored metadata (all derived at read time)
- remove JSON-in-HTML-comment metadata header entirely
- remove frontmatter entirely — entries are pure markdown
- remove `_top-of-mind` filename prefix
- add `[[id__XXXXXX|display text]]` link parsing + extraction
- add `#tag` extraction from body text
- add git-based timestamp resolution
- add link-aware service operations (safe rename that updates inbound links)
- big-bang migration script from old format to new

### what's NOT changing (yet)

- defrag machine and prompt (phase 2 — but we minimally strip dead fields)
- index note and AGENTS.md generation (phase 3)
- ID generation (`id__XXXXXX` format stays, `id.ts` unchanged)
- directory layout (`orgs/{org}/archive/`, etc.)

## Goals

- eliminate the metadata layer — entries are plain markdown, readable by any tool
- remove unreliable usage tracking from all code paths
- establish `[[id__XXXXXX|display text]]` as canonical link syntax with parsing utilities
- establish `#tag` as canonical tag syntax with extraction utilities
- provide safe mutation operations that preserve link integrity
- maintain all existing tests passing (updated for new model)
- migration script converts all existing entries in one pass

## User Stories

### US-001: Remove stored metadata — pure markdown entries

**Description:** as a developer, I want memory entries to be plain markdown files with no metadata header so the format is tool-agnostic and human-readable.

**Acceptance Criteria:**
- [ ] `MemoryEntryMetaSchema` removed or replaced with a derived type — no arktype schema for stored metadata since nothing is stored
- [ ] runtime `MemoryEntryMeta` type still exists but all fields are derived at read time (from filename, body, git)
- [ ] `used`, `last_used`, `pinned` fields removed entirely — not derived, not stored, gone
- [ ] `status` field removed — determined by directory location
- [ ] `serializeMemoryMarkdown()` produces pure markdown: `# title\n\n#tag1 #tag2\n\nbody`
- [ ] `parseMemoryMarkdown()` replaced or updated — extracts title from `# heading`, tags from `#tag`, receives id from caller (filename)
- [ ] `service.read()` is a pure read — no mutation, no side effects
- [ ] `CaptureInput` simplified — takes `title`, `body`, `tags` (optional)
- [ ] `service.capture()` writes a plain markdown file: heading + tags + body
- [ ] all tests updated — `schema.test.ts`, `service.test.ts`, `format.test.ts`
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes

### US-002: Tag extraction from `#tag` syntax

**Description:** as a developer, I want to extract tags from `#tag` syntax in note bodies so tags are inline and visible, not hidden in metadata.

**Acceptance Criteria:**
- [ ] `extractTags(body: string)` function returns `string[]` of tag names (without the `#` prefix)
- [ ] handles `#topic`, `#work`, `#people` — single-word tags
- [ ] handles `#area__work`, `#topic__design` — namespaced tags with double-underscore
- [ ] ignores `#` in headings (`# Title`, `## Subtitle` — these start a line and are followed by a space)
- [ ] ignores `#` in code blocks (fenced ` ``` ` blocks)
- [ ] ignores `#` in URLs and other non-tag contexts
- [ ] new file `src/tags.ts` (or colocated in `format.ts`)
- [ ] tests with edge cases: tags adjacent to text, tags on their own line, tags in code blocks
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes

### US-003: Link syntax — parsing and extraction

**Description:** as a developer, I want utilities to parse `[[id__XXXXXX|display text]]` links from note bodies so the system can build a link graph.

**Acceptance Criteria:**
- [ ] `extractLinks(body: string)` function returns `Array<{ id: string; displayText: string; position: { start: number; end: number } }>`
- [ ] handles `[[id__XXXXXX|display text]]` — full form with alias
- [ ] handles `[[id__XXXXXX]]` — short form, no alias (display text defaults to the ID)
- [ ] ignores malformed links (missing closing brackets, invalid ID format)
- [ ] ignores links inside fenced code blocks (` ``` `)
- [ ] `replaceLink(body: string, oldId: string, newId: string)` updates all links targeting `oldId` to point to `newId`, preserving display text
- [ ] new file `src/links.ts`
- [ ] tests with edge cases: multiple links per line, links in code blocks, links with special characters in display text, nested brackets
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes

### US-004: Git-based timestamp resolution

**Description:** as a developer, I want to resolve `createdAt` and `updatedAt` from git history so timestamps are durable without storing them in the file.

**Acceptance Criteria:**
- [ ] `getFileTimestamps(rootDir: string, filePath: string)` returns `{ createdAt: number; updatedAt: number }`
- [ ] `createdAt` from `git log --follow --diff-filter=A --format=%at -- <file>` (first commit that added the file)
- [ ] `updatedAt` from `git log -1 --format=%at -- <file>` (most recent commit touching the file)
- [ ] returns fallback timestamps (e.g., `Date.now()`) for files not yet committed (new/untracked)
- [ ] new file `src/timestamps.ts`
- [ ] tests: committed file returns correct timestamps, uncommitted file returns fallback
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes

### US-005: Safe rename operation

**Description:** as a developer, I want a service-level `rename(id, newTitle)` that updates the entry's `# heading`, filename, AND all inbound links' display text, so links don't show stale text after a rename.

**Acceptance Criteria:**
- [ ] `MemoryService` gains a `rename(id: string, newTitle: string)` method
- [ ] updates the `# heading` in the entry's markdown body
- [ ] updates the filename (new slug derived from new title, id preserved)
- [ ] scans all other entries for `[[id|old display text]]` and updates display text to `newTitle`
- [ ] only updates display text on links where it matches the OLD title (preserves custom display text)
- [ ] returns a result with the count of updated inbound links
- [ ] test: create entry A linking to entry B, rename B, verify A's link display text updated
- [ ] test: create entry A linking to entry B with custom display text, rename B, verify A's custom text preserved
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes

### US-006: Link graph queries

**Description:** as a developer, I want to query the link graph so defrag (phase 2) can use link topology as a signal.

**Acceptance Criteria:**
- [ ] `MemoryService` gains a `links(id: string)` method returning `{ inbound: Array<{ id: string; title: string }>; outbound: Array<{ id: string; displayText: string }> }`
- [ ] `inbound`: all entries whose body contains `[[id|...]]` pointing to this entry
- [ ] `outbound`: all `[[target_id|...]]` links found in this entry's body
- [ ] `MemoryService` gains an `orphans()` method returning entry IDs with zero inbound links
- [ ] `MemoryService` gains a `brokenLinks()` method returning `Array<{ sourceId: string; targetId: string }>` for links pointing to nonexistent entries
- [ ] tests for each: linked entries, orphans, broken links
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes

### US-007: Update persistence adapter

**Description:** as a developer, I want the filesystem persistence adapter to read/write pure markdown entries and derive metadata from filenames + body content.

**Acceptance Criteria:**
- [ ] `buildFilename()` produces `slug id__XXXXXX.md` (no tags in filename, no `_top-of-mind` prefix)
- [ ] `write()` serializes pure markdown: `# title\n\n#tag1 #tag2\n\nbody`
- [ ] `read()` parses: extracts id from filename, title from `# heading`, tags from `#tag`, links from `[[...]]`
- [ ] `list()` returns derived `MemoryEntryMeta` (id from filename, title from heading, tags from body)
- [ ] `isTopOfMindFilename()` and `setTopOfMind()` removed
- [ ] `readEntriesFromDir()` works with new filename format
- [ ] existing tests in `integration.test.ts` updated for new format
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes

### US-008: Update defrag prompt (minimal)

**Description:** as a developer, I want the defrag prompt to stop referencing `used`/`last_used`/`pinned` since those fields no longer exist. full graph-aware defrag is phase 2 — this story just removes dead references.

**Acceptance Criteria:**
- [ ] `EntryForDefrag` no longer includes `used`, `last_used`, or `pinned`
- [ ] `buildDefragPrompt()` stats line removed (no usage data to show)
- [ ] prompt text removes the sentence about "`used` counter and `last_used` timestamp"
- [ ] prompt text removes "pinned: true is a strong signal for hot tier"
- [ ] tiering criteria updated — hot tier signal is content relevance and tags, not usage frequency
- [ ] `DefragDecision` type unchanged (still has `hotTier`, `warmTier`, `actions`)
- [ ] `prompts-defrag.test.ts` updated
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes

### US-009: Migration script

**Description:** as a developer, I want a migration script that converts all existing entries from the old format to pure markdown in one pass.

**Acceptance Criteria:**
- [ ] script at `src/cli/migrate-to-v2.ts`
- [ ] reads all `.md` files in the memory root (all orgs, archive dirs)
- [ ] parses old format (`<!-- agent-memory:meta { ... } -->`)
- [ ] writes new format: `# title\n\n#tag1 #tag2\n\nbody` (tags converted from `["topic__x", "area__y"]` to `#topic__x #area__y`)
- [ ] strips `used`, `last_used`, `pinned`, `status`, `createdAt`, `updatedAt` (all now derived)
- [ ] renames file: removes `_top-of-mind` prefix if present, keeps `id__XXXXXX` in filename
- [ ] preserves body content including any existing `[[links]]`
- [ ] `--dry-run` flag shows what would change without writing
- [ ] `--root-dir PATH` flag to specify memory root
- [ ] idempotent — running twice produces the same result
- [ ] prints summary: entries migrated, entries skipped (already new format), errors
- [ ] test: create entries in old format in temp dir, run migration, verify new format
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes

## Functional Requirements

- FR-1: memory entries are plain markdown files — no frontmatter, no metadata header
- FR-2: `id` is extracted from the filename (`... id__XXXXXX.md`)
- FR-3: `title` is extracted from the first `# heading` in the body
- FR-4: tags use `#tag` syntax inline in the body, extracted via `extractTags()`
- FR-5: timestamps come from git history — `createdAt` from first commit, `updatedAt` from last commit
- FR-6: status is determined by directory location, not a stored field
- FR-7: link syntax is `[[id__XXXXXX|display text]]` or `[[id__XXXXXX]]` (short form)
- FR-8: `extractLinks()` parses all links from a body string, returns IDs + positions
- FR-9: `replaceLink()` updates link targets in a body string
- FR-10: `service.read()` is a pure read — no mutation, no side effects
- FR-11: `service.rename()` updates heading + filename + all inbound link display text
- FR-12: `service.links()` returns inbound + outbound links for an entry
- FR-13: `service.orphans()` returns entries with zero inbound links
- FR-14: `service.brokenLinks()` returns links pointing to nonexistent entries
- FR-15: migration script converts old format to new in one pass, idempotent, with `--dry-run`

## Non-Goals

- no changes to the defrag XState machine (phase 2)
- no index note or AGENTS.md generation changes (phase 3)
- no changes to the consolidation machine
- no semantic search or embeddings
- no link validation at write time (broken links are allowed — defrag detects them later)
- no graph visualization
- no changes to `id.ts` or ID format

## Technical Considerations

- **no new dependencies for format**: entries are pure markdown — `extractTags()` and `extractLinks()` are regex-based. no YAML parser, no frontmatter library.
- **git dependency for timestamps**: `getFileTimestamps()` shells out to git. this means git must be available in the runtime environment (Railway has it). for tests, either init a temp git repo or provide a mock/fallback.
- **tag extraction ambiguity**: `#tag` syntax can conflict with markdown headings (`# Title`) and hex colors (`#ff0000`). extraction rules must be precise: a tag is `#` followed by word characters, NOT preceded by another word character, NOT at the start of a line followed by a space (heading).
- **link parsing in code blocks**: both `extractLinks()` and `extractTags()` should ignore content inside fenced code blocks. simple approach: strip fenced blocks before extracting, or track fence state during scan.
- **safe rename is O(n)**: scanning all entries for inbound links requires reading every file. acceptable at current scale (< 500 entries).
- **`MemoryEntryMeta` becomes a derived type**: the runtime type still exists for service consumers, but nothing writes it to disk. the persistence adapter derives it on read from filename + body + git.

## Success Metrics

- all existing test files pass after updates (new model)
- `bun run typecheck` passes with zero errors
- migration script successfully converts all entries on Railway volume
- `service.read()` never writes to disk (verifiable via filesystem spy in tests)
- entry files are valid markdown readable by any markdown tool (obsidian, github, etc.)

## Open Questions

1. **tag format**: `#people` or `#topic__people`? should we keep the namespace convention from the old system or simplify? the old system used `topic__x`, `area__y` prefixes.
2. **`topics/` vs `archive/` directory distinction**: the filesystem adapter currently has both directories. does this distinction map to "status" in the new model, or should everything be flat?
3. **title extraction fallback**: if a file has no `# heading`, derive title from filename slug? or error?
4. **git timestamps in tests**: init a real temp git repo for integration tests, or mock `getFileTimestamps()`?
