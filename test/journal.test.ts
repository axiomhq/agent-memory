import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeJournalEntry, listPendingEntries, markProcessed } from "../src/journal.js";
import type { JournalQueueEntry } from "../src/schema.js";

describe("journal", () => {
  let testDir: string;
  let inboxDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agent-memory-test-${Date.now()}`);
    inboxDir = join(testDir, "inbox");
    mkdirSync(inboxDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  const createEntry = (overrides: Partial<JournalQueueEntry> = {}): JournalQueueEntry => ({
    version: "1",
    timestamp: new Date().toISOString(),
    harness: "amp",
    retrieval: { method: "amp-thread", threadId: "T-123" },
    context: { cwd: "/path/to/project" },
    ...overrides,
  });

  describe("writeJournalEntry", () => {
    test("writes valid entry to inbox", () => {
      const entry = createEntry();
      const result = writeJournalEntry(entry, { inboxDir });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatch(/\.json$/);
        expect(existsSync(result.value)).toBe(true);
      }
    });

    test("rejects invalid entry", () => {
      const entry = { version: "2" } as unknown as JournalQueueEntry;
      const result = writeJournalEntry(entry, { inboxDir });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error._tag).toBe("journal.validate");
      }
    });

    test("creates inbox dir if missing", () => {
      const newInbox = join(testDir, "new-inbox");
      const entry = createEntry();
      const result = writeJournalEntry(entry, { inboxDir: newInbox });

      expect(result.isOk()).toBe(true);
      expect(existsSync(newInbox)).toBe(true);
    });

    test("filename includes timestamp and harness", () => {
      const entry = createEntry({
        timestamp: "2026-02-13T14:30:00.000Z",
        harness: "amp",
      });
      const result = writeJournalEntry(entry, { inboxDir });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatch(/2026-02-13T14-30/);
        expect(result.value).toMatch(/_amp_/);
      }
    });
  });

  describe("listPendingEntries", () => {
    test("returns empty array for empty inbox", () => {
      const result = listPendingEntries({ inboxDir });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    test("lists entries sorted by timestamp", () => {
      const entries = [
        createEntry({ timestamp: "2026-02-13T14:00:00.000Z" }),
        createEntry({ timestamp: "2026-02-13T12:00:00.000Z" }),
        createEntry({ timestamp: "2026-02-13T13:00:00.000Z" }),
      ];

      for (const e of entries) {
        writeJournalEntry(e, { inboxDir });
      }

      const result = listPendingEntries({ inboxDir });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(3);
        // Sorted by timestamp (oldest first)
        expect(result.value[0]!.entry.timestamp).toBe("2026-02-13T12:00:00.000Z");
        expect(result.value[2]!.entry.timestamp).toBe("2026-02-13T14:00:00.000Z");
      }
    });

    test("skips invalid JSON files", () => {
      const entry = createEntry();
      writeJournalEntry(entry, { inboxDir });

      // Write invalid JSON
      const invalidPath = join(inboxDir, "invalid.json");
      Bun.write(invalidPath, "not json");

      const result = listPendingEntries({ inboxDir });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
      }
    });
  });

  describe("markProcessed", () => {
    test("moves entry to .processed dir", () => {
      const entry = createEntry();
      writeJournalEntry(entry, { inboxDir });

      const listResult = listPendingEntries({ inboxDir });
      expect(listResult.isOk()).toBe(true);
      if (!listResult.isOk()) return;

      const pending = listResult.value[0]!;
      const markResult = markProcessed(pending.id, { inboxDir });

      expect(markResult.isOk()).toBe(true);
      expect(existsSync(join(inboxDir, ".processed", `${pending.id}.json`))).toBe(true);

      const afterMark = listPendingEntries({ inboxDir });
      expect(afterMark.isOk()).toBe(true);
      if (afterMark.isOk()) {
        expect(afterMark.value.length).toBe(0);
      }
    });

    test("creates .processed dir if missing", () => {
      const processedDir = join(inboxDir, ".processed");
      expect(existsSync(processedDir)).toBe(false);

      const entry = createEntry();
      writeJournalEntry(entry, { inboxDir });

      const listResult = listPendingEntries({ inboxDir });
      if (!listResult.isOk()) return;

      markProcessed(listResult.value[0]!.id, { inboxDir });
      expect(existsSync(processedDir)).toBe(true);
    });
  });
});
