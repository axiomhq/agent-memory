# AGENTS.md

## how to work

### 1. understand the system

read the pattern language in `docs/pattern-language/` first — it describes the forces and resolutions that drive every decision. draft a conceptual model of the system and integrate your task into it. if your mental model has gaps, fill them before writing code.

### 2. build yourself a laboratory

you must have the ability to view and verify your own work. if you can't observe your changes working, you're guessing.

three tools:

1. **the laboratory** — a fast, repeatable environment where you can see your work fail and succeed. tests, REPLs, local endpoints. if you'd ask a human to check, build a lab instead.
2. **the stopwatch** — measurement that makes the invisible visible. time budgets, token counts, error rates, iteration counts. instrument first, iterate against measurements.
3. **the report** — evidence over claims. show what changed, not what you think changed. screenshots, logs, diffs, numbers.

### 3. plan before you build

draft a plan of changes. iterate on this plan with your human before implementing. the plan should answer:

- what files will change?
- what's the expected behavior after?
- how will you verify it works?
- what might go wrong?

### 4. implement in a loop

work through your plan incrementally. after each change:

- verify it works (use your laboratory)
- run `bun run typecheck` to catch regressions
- commit when a logical unit is complete

### 5. document decisions

- **non-obvious inline decisions**: jsdoc explaining WHY, not what
- **living forces and resolutions**: the pattern language (`docs/pattern-language/`) captures living forces and resolutions
- **delete obvious comments**: if the code says it, don't repeat it

### 6. review with evidence

when presenting work to your human or reviewer:

- show evidence from your laboratory, not just code
- label confidence: VERIFIED (traced/tested) vs HUNCH (pattern-match)
- if you can't cite evidence for a claim, delete the claim or label it

## quality bar

a contribution is not code — it's proven working code.

review against the three lenses from the pattern language:

- is this a record or a process? → WORKFLOW = DATA
- is every path handled? → EXHAUSTIVE STATE MODELING
- can this work outside its host? → INDEPENDENTLY INVOCABLE UNITS

**before submitting, verify:**

1. have i seen this work? not "does the code look right" — have i actually run it?
2. do the types tell the truth? am i lying to the compiler?
3. is the naming honest? would someone in 6 months be confused?
4. did i test the edges? what happens on the worst path?
5. can i explain it start to finish, and each part in isolation?

**slop indicators:**

- missing tests
- claims without evidence
- names that lie about what they contain

## voice

lowercase, terse, no sycophancy. ALL CAPS for emphasis only.

## tech stack

- **runtime**: bun
- **state machines**: xstate v5
- **schema validation**: arktype v2
- **error handling**: neverthrow (ResultAsync, tagged union errors)
- **formatting**: oxfmt
- **linting**: oxlint

## commands

```bash
bun run typecheck  # type check
bun run test       # run tests
bun run lint       # oxlint
```

## project structure

```
src/
  schema.ts           # data shapes (arktype)
  service.ts          # high-level memory API
  config.ts           # configuration loading
  id.ts               # stable ID generation
  format.ts           # markdown serialization
  journal.ts          # queue operations

  persist/            # storage boundary
    index.ts          # adapter interface
    filesystem.ts     # file-based impl

  machines/           # xstate workflows
    consolidate.ts    # consolidation machine
    defrag.ts         # defrag machine

  prompts/            # LLM prompt builders
    consolidate.ts    # zettelkasten prompt
    defrag.ts         # reorganization prompt

  adapters/           # I/O boundaries
    index.ts          # adapter interfaces
    amp.ts            # amp harness adapter
    shell.ts          # LLM shell adapter

  agents-md/          # AGENTS.md generation
    generator.ts      # section builder

  cli/                # command handlers
    index.ts          # router
```

docs/
  pattern-language/   # living review rubric — forces, resolutions, implementation guide

## code conventions

- **validation**: arktype for runtime schema validation — see SCHEMA-DERIVED TYPES pattern
- **errors**: neverthrow for typed Result handling — see ERRORS AS VALUES pattern
- **adapters**: injected at machine boundaries via `machine.provide()` — see INJECT AT THE BOUNDARY pattern
- **project structure**: organize by behavior — see COLOCATE BY BEHAVIOR pattern

## file naming

memory entries: `descriptive-title -- topic__x topic__y id__XXXXXX.md`

## cross-links

use `[[id__XXXXXX]]` syntax, resolved via grep.
