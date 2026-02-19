import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createActor, fromPromise } from "xstate";
import { createFileMemoryPersistenceAdapter } from "../src/persist/filesystem.js";
import { createMemoryService } from "../src/service.js";
import { writeJournalEntry, listPendingEntries, markProcessed } from "../src/journal.js";
import { consolidateMachine } from "../src/machines/consolidate.js";
import { defragMachine } from "../src/machines/defrag.js";
import { generateAgentsMdSection, replaceAgentsMdSection } from "../src/agents-md/generator.js";
import { generateId } from "../src/id.js";
import { extractLinks } from "../src/links.js";
import type { JournalForPrompt, ExistingEntryRef, ParsedKbEntry } from "../src/prompts/consolidate.js";
import type { EntryForDefrag, DefragAction } from "../src/prompts/defrag.js";
import type { MemoryEntry } from "../src/schema.js";

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

describe("integration tests", () => {
  let testDir: string;
  let rootDir: string;
  let inboxDir: string;
  let archiveDir: string;
  let adapter: ReturnType<typeof createFileMemoryPersistenceAdapter>;
  let service: ReturnType<typeof createMemoryService>;

  beforeEach(() => {
    testDir = join(tmpdir(), `agent-memory-integration-${Date.now()}`);
    rootDir = testDir;
    inboxDir = join(testDir, "inbox");
    archiveDir = join(testDir, "orgs", "default", "archive");
    mkdirSync(inboxDir, { recursive: true });
    mkdirSync(archiveDir, { recursive: true });
    adapter = createFileMemoryPersistenceAdapter({ rootDir });
    service = createMemoryService(adapter);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("capture → list → read roundtrip", () => {
    it("captures entry, lists it, reads it without side effects", async () => {
      const captureResult = await service.capture({
        title: "Integration Test Entry",
        body: "This tests the full capture-list-read flow.",
        tags: ["topic__testing", "area__integration"],
      });

      expect(captureResult.isOk()).toBe(true);
      if (!captureResult.isOk()) return;

      const id = captureResult.value.meta.id;
      expect(id).toMatch(/^id__[a-zA-Z0-9]{6}$/);

      const listResult = await service.list();
      expect(listResult.isOk()).toBe(true);
      if (!listResult.isOk()) return;

      expect(listResult.value).toHaveLength(1);
      expect(listResult.value[0]!.id).toBe(id);
      expect(listResult.value[0]!.title).toBe("Integration Test Entry");

      // read is pure — no side effects
      const readResult = await service.read(id);
      expect(readResult.isOk()).toBe(true);
      if (!readResult.isOk()) return;

      expect(readResult.value.body).toContain("This tests the full capture-list-read flow.");

      // reading again produces same result — no mutation
      const readResult2 = await service.read(id);
      expect(readResult2.isOk()).toBe(true);
    });

    it("read returns body with links extractable via extractLinks", async () => {
      const entry1 = await service.capture({ title: "Entry A", body: "some context", tags: [] });
      expect(entry1.isOk()).toBe(true);
      if (!entry1.isOk()) return;

      const id1 = entry1.value.meta.id;
      const entry2 = await service.capture({
        title: "Entry B",
        body: `references [[${id1}|Entry A]] inline`,
        tags: [],
      });
      expect(entry2.isOk()).toBe(true);
      if (!entry2.isOk()) return;

      const readResult = await service.read(entry2.value.meta.id);
      expect(readResult.isOk()).toBe(true);
      if (!readResult.isOk()) return;

      const links = extractLinks(readResult.value.body);
      expect(links).toHaveLength(1);
      expect(links[0]!.id).toBe(id1);
      expect(links[0]!.displayText).toBe("Entry A");
    });

    it("persists entries to filesystem", async () => {
      const captureResult = await service.capture({
        title: "Persistence Test",
        body: "Testing filesystem persistence.",
      });

      expect(captureResult.isOk()).toBe(true);
      if (!captureResult.isOk()) return;

      const files = readdirSync(archiveDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/\.md$/);
      expect(files[0]).toContain(captureResult.value.meta.id);
    });
  });

  describe("journal queue operations", () => {
    it("writes and lists journal entries", () => {
      const entry = {
        version: "1" as const,
        timestamp: new Date().toISOString(),
        harness: "manual" as const,
        retrieval: {
          method: "file" as const,
        },
        context: {
          cwd: "/test/project",
        },
      };

      const result = writeJournalEntry(entry, { inboxDir });
      expect(result.isOk()).toBe(true);

      const pending = listPendingEntries({ inboxDir });
      expect(pending.isOk()).toBe(true);
      if (!pending.isOk()) return;

      expect(pending.value).toHaveLength(1);
      expect(pending.value[0]!.entry.harness).toBe("manual");
      expect(pending.value[0]!.entry.context.cwd).toBe("/test/project");
    });

    it("marks journal entries as processed", () => {
      const entry = {
        version: "1" as const,
        timestamp: new Date().toISOString(),
        harness: "amp" as const,
        retrieval: {
          method: "amp-thread" as const,
          threadId: "T-123",
        },
        context: {
          cwd: "/project",
          repo: "owner/repo",
        },
      };

      const writeResult = writeJournalEntry(entry, { inboxDir });
      expect(writeResult.isOk()).toBe(true);
      if (!writeResult.isOk()) return;

      const entryId = writeResult.value.split("/").pop()!.replace(".json", "");
      const markResult = markProcessed(entryId, { inboxDir });
      expect(markResult.isOk()).toBe(true);

      const processedDir = join(inboxDir, ".processed");
      expect(existsSync(processedDir)).toBe(true);
      const processedFiles = readdirSync(processedDir);
      expect(processedFiles.find((f) => f.includes(entryId))).toBeDefined();
    });
  });

  describe("consolidation pipeline", () => {
    it("processes journal entries through consolidation machine with mock LLM", async () => {
      const entryData = {
        version: "1" as const,
        timestamp: new Date().toISOString(),
        harness: "amp" as const,
        retrieval: { method: "amp-thread" as const, threadId: "T-001" },
        context: { cwd: "/project", repo: "owner/repo" },
      };

      const writeResult = writeJournalEntry(entryData, { inboxDir });
      expect(writeResult.isOk()).toBe(true);
      if (!writeResult.isOk()) return;

      const filePath = writeResult.value;
      const journalId = filePath.split("/").pop()!.replace(".json", "");

      const journals: JournalForPrompt[] = [
        {
          id: journalId,
          title: "session amp",
          body: "learned: always use ResultAsync for error handling in neverthrow",
          tags: ["topic__errors", "area__patterns"],
        },
      ];

      const mockAgentOutput = JSON.stringify([
        {
          title: "ResultAsync pattern",
          body: "Use ResultAsync from neverthrow for async error handling. #topic__errors #area__patterns",
          tags: ["topic__errors", "area__patterns"],
        },
      ]);

      const writtenEntries: MemoryEntry[] = [];
      const processedQueueIds: string[] = [];

      const providers = {
        actors: {
          loadQueue: fromPromise<
            { entries: Array<{ id: string; entry: unknown }>; journals: JournalForPrompt[] },
            { limit: number }
          >(async () => {
            const pending = listPendingEntries({ inboxDir });
            if (pending.isErr()) return { entries: [], journals: [] };
            return {
              entries: pending.value.map((p) => ({ id: p.id, entry: p.entry })),
              journals,
            };
          }),

          fetchHistory: fromPromise<string, { entries: Array<{ id: string; entry: unknown }> }>(
            async () => "history content from thread T-001",
          ),

          listExisting: fromPromise<ExistingEntryRef[], void>(async () => []),

          runAgent: fromPromise<
            string,
            { journals: JournalForPrompt[]; existingEntries: ExistingEntryRef[] }
          >(async () => mockAgentOutput),

          writeEntries: fromPromise<
            Array<{ id: string; title: string; body: string }>,
            { entries: ParsedKbEntry[] }
          >(async ({ input }) => {
            const results: Array<{ id: string; title: string; body: string }> = [];
            for (const entry of input.entries) {
              const now = Date.now();
              const id = await generateId(entry.title, now);
              const memoryEntry: MemoryEntry = {
                meta: {
                  id,
                  title: entry.title,
                  tags: entry.tags,
                  org: "default",
                },
                body: entry.body,
              };
              const writeResult = await adapter.write(memoryEntry);
              if (writeResult.isOk()) {
                writtenEntries.push(memoryEntry);
                results.push({ id, title: entry.title, body: entry.body });
              }
            }
            return results;
          }),

          markProcessed: fromPromise<
            { count: number; failedIds: string[] },
            { queueIds: string[]; kbIds: string[] }
          >(async ({ input }) => {
            for (const queueId of input.queueIds) {
              const markResult = markProcessed(queueId, { inboxDir });
              if (markResult.isOk()) {
                processedQueueIds.push(queueId);
              }
            }
            return { count: processedQueueIds.length, failedIds: [] };
          }),

          commitChanges: fromPromise<void, { entryCount: number; queueCount: number }>(
            async () => {},
          ),
        },
      };

      const provided = consolidateMachine.provide(providers);
      const actor = createActor(provided, { input: { limit: 10 } });

      const result = await waitForFinal(actor);
      expect(result.value).toBe("completed");
      expect(result.context.writtenEntries).toHaveLength(1);
      expect(writtenEntries).toHaveLength(1);
      expect(processedQueueIds).toHaveLength(1);

      const listResult = await service.list();
      expect(listResult.isOk()).toBe(true);
      if (listResult.isOk()) {
        expect(listResult.value).toHaveLength(1);
        expect(listResult.value[0]!.title).toBe("ResultAsync pattern");
      }
    });

    it("handles empty agent output (nothing worth extracting)", async () => {
      const journalEntry = {
        id: "2024-01-15T11-00-00_amp_xyz789",
        entry: {
          version: "1" as const,
          timestamp: "2024-01-15T11:00:00Z",
          harness: "amp" as const,
          retrieval: { method: "amp-thread" as const, threadId: "T-002" },
          context: { cwd: "/project" },
        },
      };

      const journals: JournalForPrompt[] = [
        {
          id: journalEntry.id,
          title: "session amp",
          body: "started working on feature X",
          tags: [],
        },
      ];

      const providers = {
        actors: {
          loadQueue: fromPromise<
            { entries: Array<{ id: string; entry: unknown }>; journals: JournalForPrompt[] },
            { limit: number }
          >(async () => ({ entries: [journalEntry], journals })),

          fetchHistory: fromPromise<string, any>(async () => "history"),

          listExisting: fromPromise<ExistingEntryRef[], void>(async () => []),

          runAgent: fromPromise<string, any>(async () => "[]"),

          writeEntries: fromPromise<any[], { entries: ParsedKbEntry[] }>(async () => []),

          markProcessed: fromPromise<
            { count: number; failedIds: string[] },
            { queueIds: string[]; kbIds: string[] }
          >(async ({ input }) => ({ count: input.queueIds.length, failedIds: [] })),

          commitChanges: fromPromise<void, any>(async () => {}),
        },
      };

      const provided = consolidateMachine.provide(providers);
      const actor = createActor(provided, { input: { limit: 10 } });

      const result = await waitForFinal(actor);
      expect(result.value).toBe("completed");
      expect(result.context.writtenEntries).toHaveLength(0);
    });
  });

  describe("AGENTS.md generation", () => {
    it("generates section with hot and warm tiers", () => {
      const hotEntries = [
        {
          meta: {
            id: "id__abc123",
            title: "Hot Pattern",
            tags: ["topic__core"],
            org: "default",
          },
          body: "This is a hot-tier entry with important content.\n\nMultiple paragraphs here.",
        },
      ];

      const warmEntries = [
        {
          meta: {
            id: "id__def456",
            title: "Warm Tip",
            tags: ["topic__tips"],
            org: "default",
          },
          path: "/path/to/warm.md",
        },
      ];

      const section = generateAgentsMdSection(hotEntries, warmEntries);

      expect(section).toContain("## memory");
      expect(section).toContain("hot-tier knowledge");
      expect(section).toContain("### Hot Pattern");
      expect(section).toContain("This is a hot-tier entry");
      expect(section).toContain("### warm-tier");
      expect(section).toContain("`id__def456`: Warm Tip");
      expect(section).toContain("[topic__tips]");
    });

    it("creates file with sentinel comments", () => {
      const targetPath = join(testDir, "AGENTS.md");
      const section = "## memory\n\nTest content\n";

      replaceAgentsMdSection(targetPath, section);

      expect(existsSync(targetPath)).toBe(true);
      const content = readFileSync(targetPath, "utf-8");
      expect(content).toContain("<!-- agent-memory:start -->");
      expect(content).toContain("<!-- agent-memory:end -->");
      expect(content).toContain("## memory");
    });

    it("replaces existing section in place", () => {
      const targetPath = join(testDir, "AGENTS.md");
      const initialContent = `# Project

<!-- agent-memory:start -->
## memory

Old content here.
<!-- agent-memory:end -->

More content below.`;

      writeFileSync(targetPath, initialContent, "utf-8");

      const newSection = "## memory\n\nNew hot content.";
      replaceAgentsMdSection(targetPath, newSection);

      const updated = readFileSync(targetPath, "utf-8");
      expect(updated).toContain("# Project");
      expect(updated).toContain("New hot content");
      expect(updated).not.toContain("Old content here");
      expect(updated).toContain("More content below");
    });

    it("appends section when sentinel not present", () => {
      const targetPath = join(testDir, "AGENTS.md");
      const existingContent = `# Project

Some existing content without memory section.`;

      writeFileSync(targetPath, existingContent, "utf-8");

      const section = "## memory\n\nFresh memory content.";
      replaceAgentsMdSection(targetPath, section);

      const updated = readFileSync(targetPath, "utf-8");
      expect(updated).toContain("# Project");
      expect(updated).toContain("Some existing content without memory section");
      expect(updated).toContain("## memory");
      expect(updated).toContain("Fresh memory content");
      expect(updated).toContain("<!-- agent-memory:start -->");
    });

    it("generates AGENTS.md from captured entries", async () => {
      await service.capture({
        title: "Important Pattern",
        body: "Use ResultAsync for all async operations.",
        tags: ["topic__patterns"],
      });

      await service.capture({
        title: "Secondary Tip",
        body: "Use zod for runtime validation.",
        tags: ["topic__validation"],
      });

      const listResult = await service.list();
      expect(listResult.isOk()).toBe(true);
      if (!listResult.isOk()) return;

      // all entries as warm (hot tier determined by defrag agent)
      const warmEntries = listResult.value.map((meta) => ({
        meta,
        path: `${rootDir}/orgs/default/archive/${meta.id}.md`,
      }));

      const section = generateAgentsMdSection([], warmEntries);
      expect(section).toContain("Important Pattern");
      expect(section).toContain("Secondary Tip");
    });
  });

  describe("defrag pipeline", () => {
    it("applies rename action via defrag machine", async () => {
      const id1 = await generateId("old title", Date.now());

      await adapter.write({
        meta: {
          id: id1,
          title: "old title",
          tags: ["topic__auth"],
          org: "default",
        },
        body: "some content about auth",
      });

      const entries: EntryForDefrag[] = [
        {
          id: id1,
          title: "old title",
          body: "some content about auth",
          tags: ["topic__auth"],
        },
      ];

      const mockAgentOutput = JSON.stringify({
        actions: [{ type: "rename", id: id1, newTitle: "Auth Best Practices" }],
        hotTier: [id1],
        warmTier: [],
      });

      const appliedRenames: Array<{ id: string; newTitle: string }> = [];

      const providers = {
        actors: {
          scanEntries: fromPromise<EntryForDefrag[], void>(async () => entries),

          runAgent: fromPromise<string, { entries: EntryForDefrag[] }>(
            async () => mockAgentOutput,
          ),

          applyChanges: fromPromise<number, { actions: DefragAction[] }>(async ({ input }) => {
            let count = 0;
            for (const action of input.actions) {
              if (action.type === "rename") {
                const readResult = await adapter.read(action.id);
                if (readResult.isOk()) {
                  const updated: MemoryEntry = {
                    meta: { ...readResult.value.meta, title: action.newTitle },
                    body: readResult.value.body,
                  };
                  const writeResult = await adapter.write(updated);
                  if (writeResult.isOk()) {
                    appliedRenames.push({ id: action.id, newTitle: action.newTitle });
                    count++;
                  }
                }
              }
            }
            return count;
          }),

          generateAgentsMd: fromPromise<
            void,
            { hotTier: string[]; warmTier: string[]; entries: EntryForDefrag[] }
          >(async () => {}),

          commitChanges: fromPromise<void, void>(async () => {}),
        },
      };

      const provided = defragMachine.provide(providers);
      const actor = createActor(provided, { input: {} });

      const result = await waitForFinal(actor);
      expect(result.value).toBe("completed");
      expect(result.context.appliedActions).toBe(1);
      expect(appliedRenames).toHaveLength(1);
      expect(appliedRenames[0]!.newTitle).toBe("Auth Best Practices");

      const readResult = await adapter.read(id1);
      expect(readResult.isOk()).toBe(true);
      if (readResult.isOk()) {
        expect(readResult.value.meta.title).toBe("Auth Best Practices");
      }
    });

    it("propagates hotTier and warmTier to generateAgentsMd", async () => {
      const id1 = await generateId("hot entry", Date.now());
      const id2 = await generateId("warm entry", Date.now() + 1);

      const entries: EntryForDefrag[] = [
        {
          id: id1,
          title: "hot entry",
          body: "important",
          tags: [],
        },
        {
          id: id2,
          title: "warm entry",
          body: "useful",
          tags: [],
        },
      ];

      const mockAgentOutput = JSON.stringify({
        actions: [],
        hotTier: [id1],
        warmTier: [id2],
      });

      let capturedInput: { hotTier: string[]; warmTier: string[] } | null = null;

      const providers = {
        actors: {
          scanEntries: fromPromise<EntryForDefrag[], void>(async () => entries),

          runAgent: fromPromise<string, { entries: EntryForDefrag[] }>(
            async () => mockAgentOutput,
          ),

          applyChanges: fromPromise<number, { actions: DefragAction[] }>(async () => 0),

          generateAgentsMd: fromPromise<
            void,
            { hotTier: string[]; warmTier: string[]; entries: EntryForDefrag[] }
          >(async ({ input }) => {
            capturedInput = { hotTier: input.hotTier, warmTier: input.warmTier };
          }),

          commitChanges: fromPromise<void, void>(async () => {}),
        },
      };

      const provided = defragMachine.provide(providers);
      const actor = createActor(provided, { input: {} });

      const result = await waitForFinal(actor);
      expect(result.value).toBe("completed");
      expect(capturedInput).not.toBeNull();
      expect(capturedInput!.hotTier).toEqual([id1]);
      expect(capturedInput!.warmTier).toEqual([id2]);
    });
  });

  describe("end-to-end: journal to AGENTS.md", () => {
    it("captures journal, consolidates, and generates AGENTS.md", async () => {
      const entry = {
        version: "1" as const,
        timestamp: new Date().toISOString(),
        harness: "manual" as const,
        retrieval: {
          method: "file" as const,
        },
        context: {
          cwd: "/test/project",
        },
      };

      const writeResult = writeJournalEntry(entry, { inboxDir });
      expect(writeResult.isOk()).toBe(true);

      const pendingBefore = listPendingEntries({ inboxDir });
      expect(pendingBefore.isOk()).toBe(true);
      if (!pendingBefore.isOk()) return;
      expect(pendingBefore.value).toHaveLength(1);

      const journalId = pendingBefore.value[0]!.id;
      const journals: JournalForPrompt[] = [
        {
          id: journalId,
          title: "session manual",
          body: "learned about conventions",
          tags: [],
        },
      ];

      const mockAgentOutput = JSON.stringify([
        {
          title: "Project Convention",
          body: "Use kebab-case for file names. #topic__conventions",
          tags: ["topic__conventions"],
        },
      ]);

      const writtenIds: string[] = [];

      const providers = {
        actors: {
          loadQueue: fromPromise<
            { entries: Array<{ id: string; entry: unknown }>; journals: JournalForPrompt[] },
            { limit: number }
          >(async () => {
            const pending = listPendingEntries({ inboxDir });
            if (pending.isErr()) return { entries: [], journals: [] };
            return {
              entries: pending.value.map((p) => ({ id: p.id, entry: p.entry })),
              journals: pending.value.map((p) => ({
                id: p.id,
                title: `session ${p.entry.harness}`,
                body: `harness: ${p.entry.harness}\ncontext: ${p.entry.context.cwd}`,
                tags: [],
              })),
            };
          }),

          fetchHistory: fromPromise<string, { entries: Array<{ id: string; entry: unknown }> }>(
            async () => "history content",
          ),

          listExisting: fromPromise<ExistingEntryRef[], void>(async () => []),

          runAgent: fromPromise<
            string,
            { journals: JournalForPrompt[]; existingEntries: ExistingEntryRef[] }
          >(async () => mockAgentOutput),

          writeEntries: fromPromise<
            Array<{ id: string; title: string; body: string }>,
            { entries: ParsedKbEntry[] }
          >(async ({ input }) => {
            const results: Array<{ id: string; title: string; body: string }> = [];
            for (const entry of input.entries) {
              const now = Date.now();
              const id = await generateId(entry.title, now);
              const memoryEntry: MemoryEntry = {
                meta: {
                  id,
                  title: entry.title,
                  tags: entry.tags,
                  org: "default",
                },
                body: entry.body,
              };
              const writeResult = await adapter.write(memoryEntry);
              if (writeResult.isOk()) {
                writtenIds.push(id);
                results.push({ id, title: entry.title, body: entry.body });
              }
            }
            return results;
          }),

          markProcessed: fromPromise<
            { count: number; failedIds: string[] },
            { queueIds: string[]; kbIds: string[] }
          >(async ({ input }) => {
            for (const queueId of input.queueIds) {
              markProcessed(queueId, { inboxDir });
            }
            return { count: input.queueIds.length, failedIds: [] };
          }),

          commitChanges: fromPromise<void, { entryCount: number; queueCount: number }>(
            async () => {},
          ),
        },
      };

      const provided = consolidateMachine.provide(providers);
      const actor = createActor(provided, { input: { limit: 10 } });

      const result = await waitForFinal(actor);
      expect(result.value).toBe("completed");
      expect(writtenIds).toHaveLength(1);

      const listResult = await service.list();
      expect(listResult.isOk()).toBe(true);
      if (!listResult.isOk()) return;

      expect(listResult.value).toHaveLength(1);
      expect(listResult.value[0]!.title).toBe("Project Convention");

      const pendingAfter = listPendingEntries({ inboxDir });
      expect(pendingAfter.isOk()).toBe(true);
      if (pendingAfter.isOk()) {
        expect(pendingAfter.value).toHaveLength(0);
      }

      const readResult = await adapter.read(writtenIds[0]!);
      expect(readResult.isOk()).toBe(true);
      if (readResult.isOk()) {
        const hotEntries = [{ meta: readResult.value.meta, body: readResult.value.body }];
        const warmEntries: Array<{ meta: typeof readResult.value.meta; path: string }> = [];

        const section = generateAgentsMdSection(hotEntries, warmEntries);
        expect(section).toContain("Project Convention");
        expect(section).toContain("kebab-case");
      }
    });
  });
});
