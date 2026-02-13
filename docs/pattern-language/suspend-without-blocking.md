# SUSPEND WITHOUT BLOCKING ★★

**consider first**: [EXHAUSTIVE STATE MODELING](exhaustive-state-modeling.md)

**forces**: a workflow reaches a point where it needs external input —
human reply, CI result, approval. two concerns compete:

- **resume speed** — when the event arrives, resume fast. users notice
  latency.
- **durability** — when the server crashes, recover without data loss.
  correctness matters more than speed.

a single mechanism that handles both makes tradeoffs for one that hurt
the other. serializing on every suspend is durable but slow. keeping
everything in memory is fast but fragile. conflating the two means every
architectural choice is a compromise between the wrong axes.

**therefore**: treat suspension and crash recovery as independent
concerns with independent mechanisms. how the workflow suspends (state
transition, process exit, queue message) is a separate decision from how
it recovers (snapshots, event-sourcing, rehydration). each can be
optimized for its own axis without dragging the other along.

**intended consequences**:

- ✓ resume path optimized for speed without sacrificing durability
- ✓ recovery path optimized for correctness without constraining suspend
- ✓ can change one mechanism without redesigning the other
- △ two mechanisms means two things to get right

**consider next**: [SELF-EXPIRING STATE](self-expiring-state.md),
[CARRY, DON'T INTERPRET](carry-dont-interpret.md)

---

## in this codebase

**CLI-driven**: consolidation and defrag run as CLI commands, not
long-running daemons. each invocation:
1. loads state from filesystem
2. runs machine to completion or failure
3. persists results
4. exits

no in-memory state survives between invocations. durability via
filesystem. resume speed via journal queue (re-process pending entries).

**launchd/systemd**: scheduled triggers run CLI commands. no daemon state
to corrupt. each run starts fresh from persisted data.

**atomic writes**: crash during write leaves previous state intact.
`src/persist/filesystem.ts` uses temp file + rename.
