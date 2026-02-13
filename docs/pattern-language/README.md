# agent-memory: pattern language

> "a _pattern_ is a careful description of a perennial solution to a
> recurring problem... each pattern describes a problem that occurs over
> and over again in our environment, and then describes the core solution
> to that problem, in such a way that you can use the solution a million
> times over, without ever doing it the same way twice."
> — christopher alexander, _a pattern language_ (1977)

a pattern language is a network of patterns that call upon one another.
the links between patterns carry as much meaning as the patterns
themselves. you enter anywhere, follow the connections, and compose
solutions from the patterns you encounter.

each pattern has two layers separated by a horizontal rule:

- **evergreen** (above the rule) — forces, resolution, intended
  consequences. technology-independent. survives a rewrite.
- **in this codebase** (below the rule) — library choices, file paths,
  code examples. expected to change with the code.

## how to use

1. **start anywhere** — find the pattern that matches your problem
2. **follow the links** — directional, encoding scale:
   - **consider first** → larger patterns this one arises within
   - **consider next** → smaller patterns needed to complete this one
3. **review against** — when reviewing a PR, check it against relevant
   patterns. the three top-level patterns are the primary lenses:
   - is this a record or a process? → WORKFLOW = DATA
   - is every path handled? → EXHAUSTIVE STATE MODELING
   - can this work outside its host? → INDEPENDENTLY INVOCABLE UNITS
4. **trust the ratings** — ★★ proven in production, ★ implemented with
   limited validation, ○ proposed only

---

## patterns by scale

ordered largest (most abstract) to smallest (most specific). this is the
primary reading order — start at the top for context, drill down for
detail.

### top-level (the three lenses)

| #   | pattern                                                           | ★   |
| --- | ----------------------------------------------------------------- | --- |
| 1   | [WORKFLOW = DATA](workflow-equals-data.md)                        | ★★  |
| 2   | [EXHAUSTIVE STATE MODELING](exhaustive-state-modeling.md)         | ★★  |
| 3   | [INDEPENDENTLY INVOCABLE UNITS](independently-invocable-units.md) | ★★  |

### mid-scale

| #   | pattern                                                     | ★   | arises within                 |
| --- | ----------------------------------------------------------- | --- | ----------------------------- |
| 4   | [RECONCILE TO DESIRED STATE](reconcile-to-desired-state.md) | ★★  | EXHAUSTIVE STATE MODELING     |
| 5   | [SUSPEND WITHOUT BLOCKING](suspend-without-blocking.md)     | ★★  | EXHAUSTIVE STATE MODELING     |
| 6   | [SELF-EXPIRING STATE](self-expiring-state.md)               | ★   | EXHAUSTIVE STATE MODELING     |
| 7   | [CONTEXT-RICH EVENTS](context-rich-events.md)               | ★★  | WORKFLOW = DATA               |
| 8   | [HUMAN-FRIENDLY IDENTIFIERS](human-friendly-identifiers.md) | ★★  | WORKFLOW = DATA               |
| 9   | [INJECT AT THE BOUNDARY](inject-at-the-boundary.md)         | ★★  | INDEPENDENTLY INVOCABLE UNITS |
| 10  | [ERRORS AS VALUES](errors-as-values.md)                     | ★★  | INDEPENDENTLY INVOCABLE UNITS |
| 11  | [SCHEMA-DERIVED TYPES](schema-derived-types.md)             | ★★  | INDEPENDENTLY INVOCABLE UNITS |
| 12  | [CARRY, DON'T INTERPRET](carry-dont-interpret.md)           | ★★  | INDEPENDENTLY INVOCABLE UNITS |
| 13  | [COLOCATE BY BEHAVIOR](colocate-by-behavior.md)             | ★★  | INDEPENDENTLY INVOCABLE UNITS |

---

## references

- christopher alexander, sara ishikawa & murray silverstein,
  _a pattern language_ (oxford university press, 1977)
- christopher alexander, _the timeless way of building_
  (oxford university press, 1979)
