# EXHAUSTIVE STATE MODELING ★★

**consider first**: [WORKFLOW = DATA](workflow-equals-data.md)

**forces**: implicit control flow (async functions, if/else chains) hides
unhandled paths. failures surface at runtime, in production, as surprises.
you want the opposite — every possible state and transition explicitly
modeled, with the type system enforcing exhaustive handling. the cost is
upfront design work. the payoff is that impossible states are
unrepresentable and new events force handling at every site.

**therefore**: model workflows as finite state machines with typed states,
events, and transitions. every state declares exactly which events it
accepts and where they lead. the type system rejects unhandled paths at
compile time, not runtime. the machine definition IS the documentation.

**intended consequences**:

- ✓ impossible states are compile errors
- ✓ new events force exhaustive handling
- ✓ machines are serializable data (connects to WORKFLOW = DATA)
- ✓ visual inspection — the machine definition IS the documentation
- △ upfront modeling cost per workflow

**consider next**: [RECONCILE TO DESIRED STATE](reconcile-to-desired-state.md),
[SUSPEND WITHOUT BLOCKING](suspend-without-blocking.md),
[SELF-EXPIRING STATE](self-expiring-state.md)

---

## in this codebase

**framework**: XState v5 for state machine definition, actor model for
runtime execution. typed states, events, context, and actions.

**consolidation machine**: `src/machines/consolidate.ts`
states: `loadQueue → fetchHistory → listExisting → runAgent → parseOutput → writeEntries → markProcessed → commitChanges → completed | failed`

**defrag machine**: `src/machines/defrag.ts`
states: `scanEntries → runAgent → parseOutput → applyChanges → generateAgentsMd → commitChanges → completed | failed`

**persistence adapter**: `src/persist/index.ts` — `MemoryPersistenceAdapter`
interface with typed errors.

**prompt builders**: `src/prompts/consolidate.ts`, `src/prompts/defrag.ts` —
pure functions for building LLM prompts, with `parseConsolidationOutput()`
and `parseDefragOutput()` validators.
