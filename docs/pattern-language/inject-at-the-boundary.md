# INJECT AT THE BOUNDARY ★★

**consider first**: [INDEPENDENTLY INVOCABLE UNITS](independently-invocable-units.md)

**forces**: workflows need to interact with external systems —
persistence, agents, APIs. you need them testable in isolation (fast,
deterministic). but they also need real external systems in production
(slow, non-deterministic). direct calls couple workflow logic to specific
implementations; mocking at every call site scatters the boundary.

**therefore**: define adapter interfaces for each I/O boundary. inject
implementations. workflows call adapters; adapters call external systems.
the boundary is explicit, singular, and swappable. domain code speaks in
domain terms only — integration modules handle external vocabulary,
payload shapes, and authentication. external service names never appear
in domain code.

**intended consequences**:

- ✓ workflows testable without external systems
- ✓ swap implementations without changing workflow logic
- ✓ domain vocabulary stays coherent — adding integrations doesn't change domain code
- △ one more layer of indirection per I/O boundary
- △ boundary abstractions must be designed carefully

**consider next**: [CARRY, DON'T INTERPRET](carry-dont-interpret.md)

---

## in this codebase

**adapter interfaces**: 
- `MemoryPersistenceAdapter` at `src/persist/index.ts`
- `ConsolidateAdapters` at `src/adapters/index.ts`

**persistence adapter**: `src/persist/filesystem.ts` implements
`MemoryPersistenceAdapter` with atomic write-rename pattern.

**LLM adapter**: `src/adapters/shell.ts` — `executeShellLLM()` pipes
prompt to configured shell command via stdin.

**amp adapter**: `src/adapters/amp.ts` — writes journal entries, fetches
thread history via `amp thread read` CLI.

**machine injection**: XState machines use `machine.provide()` to inject
adapters at runtime. machines declare stub actors that throw if not
provided.
