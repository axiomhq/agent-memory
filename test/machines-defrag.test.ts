import { describe, it, expect } from "bun:test";
import { createActor, fromPromise } from "xstate";
import { defragMachine } from "../src/machines/defrag.js";
import type { EntryForDefrag, DefragDecision, DefragAction } from "../src/prompts/defrag.js";

function waitForFinal(
  actor: ReturnType<typeof createActor>,
): Promise<{ value: string; context: any }> {
  return new Promise((resolve, reject) => {
    actor.subscribe({
      next: (state) => {
        if (state.status === "done") {
          resolve({ value: state.value as string, context: state.context });
        }
      },
      error: reject,
    });
    actor.start();
  });
}

function createTestProviders(overrides: {
  entries?: EntryForDefrag[];
  agentOutput?: string;
  scanError?: boolean;
  agentError?: boolean;
  applyError?: boolean;
  generateError?: boolean;
  commitError?: boolean;
}) {
  const entries = overrides.entries ?? [];
  const agentOutput = overrides.agentOutput ?? JSON.stringify({ actions: [], topOfMind: [] });

  let capturedGenerateInput: { topOfMind: string[]; entries: EntryForDefrag[] } | null = null;

  return {
    providers: {
      actors: {
        scanEntries: fromPromise<EntryForDefrag[], void>(async () => {
          if (overrides.scanError) throw new Error("scanEntries failed");
          return entries;
        }),

        runAgent: fromPromise<string, { entries: EntryForDefrag[] }>(async () => {
          if (overrides.agentError) throw new Error("agent failed");
          return agentOutput;
        }),

        applyChanges: fromPromise<number, { actions: DefragAction[] }>(async ({ input }) => {
          if (overrides.applyError) throw new Error("applyChanges failed");
          return input.actions.length;
        }),

        generateAgentsMd: fromPromise<
          void,
          { topOfMind: string[]; entries: EntryForDefrag[] }
        >(async ({ input }) => {
          capturedGenerateInput = input;
          if (overrides.generateError) throw new Error("generateAgentsMd failed");
        }),

        commitChanges: fromPromise<void, void>(async () => {
          if (overrides.commitError) throw new Error("commitChanges failed");
        }),
      },
    },
    getCapturedGenerateInput: () => capturedGenerateInput,
  };
}

describe("defrag machine", () => {
  it("completes immediately when no entries exist", async () => {
    const { providers } = createTestProviders({ entries: [] });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.entries).toHaveLength(0);
  });

  it("runs full pipeline: scanEntries → runAgent → parseOutput → applyChanges → generateAgentsMd → commitChanges → completed", async () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__001",
        title: "auth note",
        body: "use raw body for HMAC",
        tags: ["auth"],
        used: 5,
        last_used: "2024-01-15",
        topOfMind: false,
        status: "promoted",
      },
    ];
    const agentOutput = JSON.stringify({
      actions: [{ type: "rename", id: "id__001", newTitle: "HMAC requires raw body" }],
      topOfMind: ["id__001"],
    });

    const { providers } = createTestProviders({ entries, agentOutput });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.entries).toHaveLength(1);
    expect(result.context.decision?.actions).toHaveLength(1);
    expect(result.context.appliedActions).toBe(1);
  });

  it("completes when agent returns empty actions (no changes needed)", async () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__001",
        title: "good note",
        body: "already organized",
        tags: ["topic"],
        used: 3,
        last_used: "2024-01-15",
        topOfMind: false,
        status: "promoted",
      },
    ];

    const { providers } = createTestProviders({ entries, agentOutput: JSON.stringify({ actions: [], topOfMind: ["id__001"] }) });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.decision?.actions).toHaveLength(0);
    expect(result.context.appliedActions).toBe(0);
  });

  it("transitions to failed when scanEntries errors", async () => {
    const { providers } = createTestProviders({ scanError: true });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.scanEntries");
    expect(result.context.error.message).toContain("scanEntries failed");
  });

  it("transitions to failed when runAgent errors", async () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__001",
        title: "test",
        body: "content",
        tags: [],
        used: 1,
        last_used: "2024-01-15",
        topOfMind: false,
        status: "promoted",
      },
    ];

    const { providers } = createTestProviders({ entries, agentError: true });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.runAgent");
    expect(result.context.error.message).toContain("agent failed");
  });

  it("transitions to failed when applyChanges errors", async () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__001",
        title: "test",
        body: "content",
        tags: [],
        used: 1,
        last_used: "2024-01-15",
        topOfMind: false,
        status: "promoted",
      },
    ];
    const agentOutput = JSON.stringify({
      actions: [{ type: "archive", id: "id__001", reason: "outdated" }],
      topOfMind: [],
    });

    const { providers } = createTestProviders({ entries, agentOutput, applyError: true });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.applyChanges");
    expect(result.context.error.message).toContain("applyChanges failed");
  });

  it("transitions to failed on malformed agent output", async () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__001",
        title: "test",
        body: "content",
        tags: [],
        used: 1,
        last_used: "2024-01-15",
        topOfMind: false,
        status: "promoted",
      },
    ];

    const { providers } = createTestProviders({ entries, agentOutput: "not valid json" });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.parseOutput");
    expect(result.context.parseError).toContain("not valid JSON");
  });

  it("propagates topOfMind to generateAgentsMd", async () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__001",
        title: "hot entry",
        body: "frequently used",
        tags: ["core"],
        used: 10,
        last_used: "2024-01-20",
        topOfMind: true,
        status: "promoted",
      },
      {
        id: "id__002",
        title: "warm entry",
        body: "sometimes used",
        tags: ["utils"],
        used: 3,
        last_used: "2024-01-10",
        topOfMind: false,
        status: "promoted",
      },
    ];
    const agentOutput = JSON.stringify({
      actions: [],
      topOfMind: ["id__001"],
    });

    const { providers, getCapturedGenerateInput } = createTestProviders({ entries, agentOutput });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");

    const captured = getCapturedGenerateInput();
    expect(captured).not.toBeNull();
    expect(captured!.topOfMind).toEqual(["id__001"]);
    expect(captured!.entries).toHaveLength(2);
  });

  it("transitions to failed when generateAgentsMd errors", async () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__001",
        title: "test",
        body: "content",
        tags: [],
        used: 1,
        last_used: "2024-01-15",
        topOfMind: false,
        status: "promoted",
      },
    ];

    const { providers } = createTestProviders({ entries, generateError: true });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.generateAgentsMd");
  });

  it("transitions to failed when commitChanges errors", async () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__001",
        title: "test",
        body: "content",
        tags: [],
        used: 1,
        last_used: "2024-01-15",
        topOfMind: false,
        status: "promoted",
      },
    ];

    const { providers } = createTestProviders({ entries, commitError: true });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.commitChanges");
  });

  it("handles multiple actions in agent output", async () => {
    const entries: EntryForDefrag[] = [
      { id: "id__001", title: "a", body: "content a", tags: [], used: 1, last_used: "2024-01-15", topOfMind: false, status: "promoted" },
      { id: "id__002", title: "b", body: "content b", tags: [], used: 1, last_used: "2024-01-15", topOfMind: false, status: "promoted" },
      { id: "id__003", title: "c", body: "content c", tags: [], used: 1, last_used: "2024-01-15", topOfMind: false, status: "promoted" },
    ];
    const agentOutput = JSON.stringify({
      actions: [
        { type: "rename", id: "id__001", newTitle: "renamed a" },
        { type: "archive", id: "id__002", reason: "duplicate" },
        { type: "update-tags", id: "id__003", tags: ["topic__new"] },
      ],
      topOfMind: ["id__001", "id__003"],
    });

    const { providers } = createTestProviders({ entries, agentOutput });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.decision?.actions).toHaveLength(3);
    expect(result.context.appliedActions).toBe(3);
  });

  it("handles merge action from agent", async () => {
    const entries: EntryForDefrag[] = [
      { id: "id__001", title: "auth a", body: "content a", tags: ["auth"], used: 2, last_used: "2024-01-15", topOfMind: false, status: "promoted" },
      { id: "id__002", title: "auth b", body: "content b", tags: ["auth"], used: 3, last_used: "2024-01-16", topOfMind: false, status: "promoted" },
    ];
    const agentOutput = JSON.stringify({
      actions: [
        { type: "merge", sources: ["id__001", "id__002"], title: "merged auth", body: "combined content", tags: ["auth"] },
      ],
      topOfMind: [],
    });

    const { providers } = createTestProviders({ entries, agentOutput });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.decision?.actions).toHaveLength(1);
    expect(result.context.decision?.actions[0].type).toBe("merge");
  });

  it("handles split action from agent", async () => {
    const entries: EntryForDefrag[] = [
      { id: "id__big", title: "large note", body: "very long content...", tags: [], used: 5, last_used: "2024-01-15", topOfMind: false, status: "promoted" },
    ];
    const agentOutput = JSON.stringify({
      actions: [
        {
          type: "split",
          source: "id__big",
          entries: [
            { title: "part 1", body: "first half", tags: [] },
            { title: "part 2", body: "second half", tags: [] },
          ],
        },
      ],
      topOfMind: [],
    });

    const { providers } = createTestProviders({ entries, agentOutput });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.decision?.actions).toHaveLength(1);
    expect(result.context.decision?.actions[0].type).toBe("split");
  });

  describe("WORKFLOW = DATA: snapshot serialization", () => {
    it("context is JSON-serializable (no functions)", async () => {
      const entries: EntryForDefrag[] = [
        { id: "id__001", title: "test", body: "content", tags: [], used: 1, last_used: "2024-01-15", topOfMind: false, status: "promoted" },
      ];
      const agentOutput = JSON.stringify({
        actions: [{ type: "rename", id: "id__001", newTitle: "renamed" }],
        topOfMind: ["id__001"],
      });

      const { providers } = createTestProviders({ entries, agentOutput });
      const provided = defragMachine.provide(providers);
      const actor = createActor(provided, { input: {} });

      await waitForFinal(actor);

      const snapshot = actor.getPersistedSnapshot();
      const snapshotJson = JSON.parse(JSON.stringify(snapshot));

      expect(snapshotJson.context.entries).toHaveLength(1);
      expect(snapshotJson.context.appliedActions).toBe(1);
      expect(typeof snapshotJson.context).toBe("object");
    });

    it("can restore from snapshot with fresh provide()", async () => {
      const entries: EntryForDefrag[] = [
        { id: "id__001", title: "test", body: "content", tags: [], used: 1, last_used: "2024-01-15", topOfMind: false, status: "promoted" },
      ];
      const agentOutput = JSON.stringify({
        actions: [{ type: "rename", id: "id__001", newTitle: "renamed" }],
        topOfMind: ["id__001"],
      });

      const { providers } = createTestProviders({ entries, agentOutput });
      const provided = defragMachine.provide(providers);
      const actor = createActor(provided, { input: {} });

      await waitForFinal(actor);

      const snapshot = actor.getPersistedSnapshot();
      const snapshotJson = JSON.parse(JSON.stringify(snapshot));

      const { providers: freshProviders } = createTestProviders({ entries: [] });
      const freshProvided = defragMachine.provide(freshProviders);
      const restoredActor = createActor(freshProvided, { snapshot: snapshotJson, input: {} });

      expect(restoredActor.getSnapshot().value).toBe("completed");
      expect(restoredActor.getSnapshot().context.entries).toHaveLength(1);
      expect(restoredActor.getSnapshot().context.appliedActions).toBe(1);
    });
  });
});
