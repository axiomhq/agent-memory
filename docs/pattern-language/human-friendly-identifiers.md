# HUMAN-FRIENDLY IDENTIFIERS ★★

**consider first**: [WORKFLOW = DATA](workflow-equals-data.md)

**forces**: identifiers leak into every human touchpoint — logs, URLs,
filenames, slack threads, terminal output. every time someone debugs,
reviews, or discusses work, they interact with IDs. most ID schemes
optimize for machine concerns (uniqueness, collision resistance) and
treat human readability as a non-goal.

but humans are the ones who copy-paste IDs between tools, scan log
output for a specific workflow, sort directories to find recent work,
and glance at a string to know what kind of thing it refers to. when
IDs are opaque, every interaction with the system has a small friction
cost that compounds across a day.

**therefore**: design identifiers for the humans who will read, copy,
sort, and discuss them. an ID should be self-describing (what kind of
thing), temporally sortable (when it was created), and mechanically
selectable (no characters that break copy behavior).

**intended consequences**:

- ✓ reduced friction at every human-ID interaction
- ✓ type and recency visible at a glance without lookup
- ✓ IDs work as filenames, URL slugs, and log keys without escaping
- △ longer than opaque IDs
- △ format encodes assumptions (timestamp granularity, prefix registry)

**consider next**: [INJECT AT THE BOUNDARY](inject-at-the-boundary.md)

---

## in this codebase

**format**: `id__XXXXXX` where X is base58 (6 characters).

```
id__a1b2c3
id__kJ9XmZ
```

**alphabet**: base58 via custom encoding. drops ambiguous glyphs (`0`/`O`,
`I`/`l`) so IDs stay readable across fonts. see [unkey: the UX of
UUIDs](https://www.unkey.com/blog/uuid-ux).

**generation**: `src/id.ts` — `generateId(title, createdAt)` produces
deterministic 6-char hash from title + timestamp.

**validation**: `ID_PATTERN` regex validates format. `isValidId()` helper.

**filename convention**: memory entries use descriptive filename with
embedded ID:

```
xstate-guard-patterns -- topic__xstate id__a1b2c3.md
neverthrow-error-tags -- topic__neverthrow id__c3d4e5.md
```

**cross-links**: `[[id__XXXXXX]]` syntax. resolved via grep.
