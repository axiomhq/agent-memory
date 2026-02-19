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

function entry(id: string, title: string, body: string, tags: string[] = []): EntryForDefrag {
  return { id, title, body, tags };
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
      entry("id__001", "auth note", "use raw body for HMAC", ["auth"]),
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
      entry("id__001", "good note", "already organized", ["topic"]),
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
    const { providers } = createTestProviders({ entries: [entry("id__001", "test", "content")], agentError: true });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.runAgent");
    expect(result.context.error.message).toContain("agent failed");
  });

  it("transitions to failed when applyChanges errors", async () => {
    const agentOutput = JSON.stringify({
      actions: [{ type: "archive", id: "id__001", reason: "outdated" }],
      topOfMind: [],
    });

    const { providers } = createTestProviders({ entries: [entry("id__001", "test", "content")], agentOutput, applyError: true });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.applyChanges");
    expect(result.context.error.message).toContain("applyChanges failed");
  });

  it("transitions to failed on malformed agent output", async () => {
    const { providers } = createTestProviders({ entries: [entry("id__001", "test", "content")], agentOutput: "not valid json" });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.parseOutput");
    expect(result.context.parseError).toContain("not valid JSON");
  });

  it("propagates topOfMind to generateAgentsMd", async () => {
    const entries: EntryForDefrag[] = [
      entry("id__001", "important entry", "foundational knowledge", ["core"]),
      entry("id__002", "other entry", "useful context", ["utils"]),
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
    const { providers } = createTestProviders({ entries: [entry("id__001", "test", "content")], generateError: true });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.generateAgentsMd");
  });

  it("transitions to failed when commitChanges errors", async () => {
    const { providers } = createTestProviders({ entries: [entry("id__001", "test", "content")], commitError: true });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("defrag.commitChanges");
  });

  it("handles multiple actions in agent output", async () => {
    const entries: EntryForDefrag[] = [
      entry("id__001", "a", "content a"),
      entry("id__002", "b", "content b"),
      entry("id__003", "c", "content c"),
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
      entry("id__001", "auth a", "content a", ["auth"]),
      entry("id__002", "auth b", "content b", ["auth"]),
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

    const { providers } = createTestProviders({ entries: [entry("id__big", "large note", "very long content...")], agentOutput });
    const provided = defragMachine.provide(providers);
    const actor = createActor(provided, { input: {} });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.decision?.actions).toHaveLength(1);
    expect(result.context.decision?.actions[0].type).toBe("split");
  });

  describe("WORKFLOW = DATA: snapshot serialization", () => {
    it("context is JSON-serializable (no functions)", async () => {
      const agentOutput = JSON.stringify({
        actions: [{ type: "rename", id: "id__001", newTitle: "renamed" }],
        topOfMind: ["id__001"],
      });

      const { providers } = createTestProviders({ entries: [entry("id__001", "test", "content")], agentOutput });
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
      const agentOutput = JSON.stringify({
        actions: [{ type: "rename", id: "id__001", newTitle: "renamed" }],
        topOfMind: ["id__001"],
      });

      const { providers } = createTestProviders({ entries: [entry("id__001", "test", "content")], agentOutput });
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
