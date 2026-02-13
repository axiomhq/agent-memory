# RECONCILE TO DESIRED STATE ★★

**consider first**: [EXHAUSTIVE STATE MODELING](exhaustive-state-modeling.md)

**forces**: autonomous agents are useful because they're stochastic —
they explore, improvise, take unexpected actions. restricting their side
effects limits capability. but you need guaranteed lifecycle outcomes:
PRs created, notifications sent, retries bounded. autonomy and
guarantees pull in opposite directions.

**therefore**: wrap agent execution in a deterministic lifecycle. the
machine defines desired outcomes as states. each transition checks
current reality and converges — it doesn't assume what the agent did or
didn't do. the agent takes its shot; the machine ensures the target is
hit.

**intended consequences**:

- ✓ agents retain full autonomy within steps
- ✓ lifecycle outcomes guaranteed regardless of agent behavior
- ✓ transitions are idempotent — safe to re-run after crash
- △ some work may be duplicated (agent creates PR, machine also checks/creates)

**consider next**: [SUSPEND WITHOUT BLOCKING](suspend-without-blocking.md)

---

## in this codebase

**consolidation machine**: after LLM produces output, `parseOutput` state
validates JSON structure. invalid output routes to `failed` state with
parse error in context. valid output continues to `writeEntries`.

**defrag machine**: LLM decides tier assignment. machine writes AGENTS.md
sections to all configured targets. idempotent via sentinel comments:

```markdown
<!-- agent-memory:start -->
... managed content ...
<!-- agent-memory:end -->
```

**atomic writes**: `src/persist/filesystem.ts` uses write-to-temp-then-rename
pattern. crash mid-write leaves either old file or new file, never
partial state.

**usage tracking**: `src/service.ts` increments `used` counter and updates
`last_used` timestamp on every read. reconciliation happens implicitly.
