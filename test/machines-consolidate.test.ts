import { describe, it, expect } from "bun:test";
import { createActor, fromPromise } from "xstate";
import { consolidateMachine } from "../src/machines/consolidate.js";
import type { JournalForPrompt, ExistingEntryRef, ParsedKbEntry } from "../src/prompts/consolidate.js";

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
  queueEntries?: Array<{ id: string; entry: unknown }>;
  journals?: JournalForPrompt[];
  existingEntries?: ExistingEntryRef[];
  agentOutput?: string;
  writeError?: boolean;
  agentError?: boolean;
  loadError?: boolean;
  fetchHistoryError?: boolean;
  listExistingError?: boolean;
  markFailIds?: string[];
  markError?: boolean;
  commitError?: boolean;
}) {
  const queueEntries = overrides.queueEntries ?? [];
  const journals = overrides.journals ?? [];
  const existingEntries = overrides.existingEntries ?? [];
  const agentOutput = overrides.agentOutput ?? "[]";
  const markFailIds = overrides.markFailIds ?? [];

  return {
    actors: {
      loadQueue: fromPromise<
        { entries: Array<{ id: string; entry: unknown }>; journals: JournalForPrompt[] },
        { limit: number }
      >(async () => {
        if (overrides.loadError) throw new Error("loadQueue failed");
        return { entries: queueEntries, journals };
      }),

      fetchHistory: fromPromise<
        string,
        { entries: Array<{ id: string; entry: unknown }> }
      >(async () => {
        if (overrides.fetchHistoryError) throw new Error("fetchHistory failed");
        return "history content";
      }),

      listExisting: fromPromise<ExistingEntryRef[], void>(async () => {
        if (overrides.listExistingError) throw new Error("listExisting failed");
        return existingEntries;
      }),

      runAgent: fromPromise<
        string,
        { journals: JournalForPrompt[]; existingEntries: ExistingEntryRef[]; historyContent: string }
      >(async () => {
        if (overrides.agentError) throw new Error("agent failed");
        return agentOutput;
      }),

      writeEntries: fromPromise<
        Array<{ id: string; title: string; body: string }>,
        { entries: ParsedKbEntry[] }
      >(async ({ input }) => {
        if (overrides.writeError) throw new Error("write failed");
        return input.entries.map((e, i) => ({
          id: `id__${String(i).padStart(6, "0")}`,
          title: e.title,
          body: e.body,
        }));
      }),

      markProcessed: fromPromise<
        { count: number; failedIds: string[] },
        { queueIds: string[]; kbIds: string[] }
      >(async ({ input }) => {
        if (overrides.markError) throw new Error("markProcessed failed");
        const failedIds = input.queueIds.filter((id) => markFailIds.includes(id));
        const count = input.queueIds.length - failedIds.length;
        return { count, failedIds };
      }),

      commitChanges: fromPromise<void, { entryCount: number; queueCount: number }>(
        async () => {
          if (overrides.commitError) throw new Error("commitChanges failed");
        },
      ),
    },
  } as const;
}

describe("consolidate machine", () => {
  it("completes immediately when queue is empty", async () => {
    const providers = createTestProviders({ queueEntries: [] });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.queueEntries).toHaveLength(0);
    expect(result.context.journals).toHaveLength(0);
  });

  it("runs full pipeline: loadQueue → fetchHistory → listExisting → runAgent → parseOutput → writeEntries → markProcessed → commitChanges → completed", async () => {
    const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
    const journals: JournalForPrompt[] = [
      {
        id: "q__001",
        title: "auth gotcha",
        body: "raw body",
        tags: ["auth"],
      },
    ];
    const existingEntries: ExistingEntryRef[] = [
      { id: "id__prev1", title: "existing note", tags: ["topic__auth"] },
    ];
    const agentOutput = JSON.stringify([
      {
        title: "HMAC requires raw body",
        body: "webhook verification needs raw body #auth",
        tags: ["auth"],
      },
    ]);

    const providers = createTestProviders({ queueEntries, journals, existingEntries, agentOutput });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.writtenEntries).toHaveLength(1);
    expect(result.context.processedCount).toBe(1);
    expect(result.context.failedQueueIds).toHaveLength(0);
    expect(result.context.historyContent).toBe("history content");
    expect(result.context.existingEntries).toHaveLength(1);
  });

  it("completes when agent returns empty array (nothing worth extracting)", async () => {
    const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
    const journals: JournalForPrompt[] = [
      {
        id: "q__001",
        title: "started work",
        body: "nothing interesting",
        tags: [],
      },
    ];

    const providers = createTestProviders({ queueEntries, journals, agentOutput: "[]" });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.writtenEntries).toHaveLength(0);
    expect(result.context.processedCount).toBe(1);
  });

  it("transitions to failed when loadQueue errors", async () => {
    const providers = createTestProviders({ loadError: true });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("consolidate.loadQueue");
    expect(result.context.error.message).toContain("loadQueue failed");
  });

  it("transitions to failed when fetchHistory errors", async () => {
    const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
    const journals: JournalForPrompt[] = [{ id: "q__001", title: "test", body: "content", tags: [] }];

    const providers = createTestProviders({ queueEntries, journals, fetchHistoryError: true });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("consolidate.fetchHistory");
  });

  it("transitions to failed when listExisting errors", async () => {
    const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
    const journals: JournalForPrompt[] = [{ id: "q__001", title: "test", body: "content", tags: [] }];

    const providers = createTestProviders({ queueEntries, journals, listExistingError: true });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("consolidate.listExisting");
  });

  it("transitions to failed when runAgent errors", async () => {
    const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
    const journals: JournalForPrompt[] = [{ id: "q__001", title: "test", body: "content", tags: [] }];

    const providers = createTestProviders({ queueEntries, journals, agentError: true });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("consolidate.runAgent");
    expect(result.context.error.message).toContain("agent failed");
  });

  it("transitions to failed when writeEntries errors", async () => {
    const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
    const journals: JournalForPrompt[] = [{ id: "q__001", title: "test", body: "content", tags: [] }];
    const agentOutput = JSON.stringify([{ title: "note", body: "content", tags: [] }]);

    const providers = createTestProviders({ queueEntries, journals, agentOutput, writeError: true });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("consolidate.writeEntries");
    expect(result.context.error.message).toContain("write failed");
  });

  it("transitions to failed on malformed agent output", async () => {
    const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
    const journals: JournalForPrompt[] = [{ id: "q__001", title: "test", body: "content", tags: [] }];

    const providers = createTestProviders({ queueEntries, journals, agentOutput: "not valid json at all" });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.parseError).toContain("not valid JSON");
    expect(result.context.error._tag).toBe("consolidate.parseOutput");
  });

  it("tracks partial mark failures without going to failed state", async () => {
    const queueEntries = [
      { id: "q__001", entry: { title: "test1", body: "content" } },
      { id: "q__002", entry: { title: "test2", body: "content" } },
    ];
    const journals: JournalForPrompt[] = [
      { id: "q__001", title: "test1", body: "content", tags: [] },
      { id: "q__002", title: "test2", body: "content", tags: [] },
    ];

    const providers = createTestProviders({
      queueEntries,
      journals,
      agentOutput: "[]",
      markFailIds: ["q__002"],
    });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.processedCount).toBe(1);
    expect(result.context.failedQueueIds).toEqual(["q__002"]);
  });

  it("transitions to failed when markProcessed errors", async () => {
    const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
    const journals: JournalForPrompt[] = [{ id: "q__001", title: "test", body: "content", tags: [] }];

    const providers = createTestProviders({ queueEntries, journals, agentOutput: "[]", markError: true });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("consolidate.markProcessed");
  });

  it("transitions to failed when commitChanges errors", async () => {
    const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
    const journals: JournalForPrompt[] = [{ id: "q__001", title: "test", body: "content", tags: [] }];

    const providers = createTestProviders({ queueEntries, journals, agentOutput: "[]", commitError: true });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("failed");
    expect(result.context.error._tag).toBe("consolidate.commitChanges");
  });

  it("passes limit through to loadQueue", async () => {
    let capturedLimit = 0;

    const providers = {
      actors: {
        loadQueue: fromPromise<
          { entries: Array<{ id: string; entry: unknown }>; journals: JournalForPrompt[] },
          { limit: number }
        >(async ({ input }) => {
          capturedLimit = input.limit;
          return { entries: [], journals: [] };
        }),
        fetchHistory: fromPromise<string, any>(async () => ""),
        listExisting: fromPromise<ExistingEntryRef[], void>(async () => []),
        runAgent: fromPromise<string, any>(async () => "[]"),
        writeEntries: fromPromise<any[], any>(async () => []),
        markProcessed: fromPromise<any, any>(async () => ({ count: 0, failedIds: [] })),
        commitChanges: fromPromise<void, any>(async () => {}),
      },
    } as const;

    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 25 } });

    await waitForFinal(actor);
    expect(capturedLimit).toBe(25);
  });

  it("handles multiple entries written from agent output", async () => {
    const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
    const journals: JournalForPrompt[] = [
      { id: "q__001", title: "multi learning", body: "several things", tags: ["ops"] },
    ];
    const agentOutput = JSON.stringify([
      { title: "note one", body: "first learning #ops", tags: ["ops"] },
      { title: "note two", body: "second learning #ops", tags: ["ops"] },
      { title: "note three", body: "third learning #ops", tags: ["ops"] },
    ]);

    const providers = createTestProviders({ queueEntries, journals, agentOutput });
    const provided = consolidateMachine.provide(providers);
    const actor = createActor(provided, { input: { limit: 50 } });

    const result = await waitForFinal(actor);
    expect(result.value).toBe("completed");
    expect(result.context.writtenEntries).toHaveLength(3);
    expect(result.context.writtenEntries[0].title).toBe("note one");
    expect(result.context.writtenEntries[1].title).toBe("note two");
    expect(result.context.writtenEntries[2].title).toBe("note three");
  });

  describe("WORKFLOW = DATA: snapshot serialization", () => {
    it("context is JSON-serializable (no functions)", async () => {
      const providers = createTestProviders({ queueEntries: [] });
      const provided = consolidateMachine.provide(providers);
      const actor = createActor(provided, { input: { limit: 50 } });

      await waitForFinal(actor);

      const snapshot = actor.getPersistedSnapshot();
      const snapshotJson = JSON.parse(JSON.stringify(snapshot));

      expect(snapshotJson.context.limit).toBe(50);
      expect(snapshotJson.context.queueEntries).toEqual([]);
      expect(typeof snapshotJson.context).toBe("object");
    });

    it("can restore from snapshot with fresh provide()", async () => {
      const queueEntries = [{ id: "q__001", entry: { title: "test", body: "content" } }];
      const journals: JournalForPrompt[] = [{ id: "q__001", title: "test", body: "content", tags: [] }];
      const agentOutput = JSON.stringify([{ title: "note", body: "content", tags: [] }]);

      const providers = createTestProviders({ queueEntries, journals, agentOutput });
      const provided = consolidateMachine.provide(providers);
      const actor = createActor(provided, { input: { limit: 50 } });

      await waitForFinal(actor);

      const snapshot = actor.getPersistedSnapshot();
      const snapshotJson = JSON.parse(JSON.stringify(snapshot));

      const freshProviders = createTestProviders({ queueEntries: [], agentOutput: "[]" });
      const freshProvided = consolidateMachine.provide(freshProviders);
      const restoredActor = createActor(freshProvided, { snapshot: snapshotJson, input: { limit: 50 } });

      expect(restoredActor.getSnapshot().value).toBe("completed");
      expect(restoredActor.getSnapshot().context.limit).toBe(50);
      expect(restoredActor.getSnapshot().context.writtenEntries).toHaveLength(1);
    });
  });
});
