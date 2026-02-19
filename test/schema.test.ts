import { describe, test, expect } from "bun:test";
import { type } from "arktype";
import { JournalQueueEntrySchema } from "../src/schema.js";
import type { MemoryEntryMeta } from "../src/schema.js";

describe("schema", () => {
  describe("JournalQueueEntrySchema", () => {
    test("accepts valid amp-thread entry", () => {
      const entry = {
        version: "1",
        timestamp: "2026-02-13T12:00:00Z",
        harness: "amp",
        retrieval: {
          method: "amp-thread",
          threadId: "T-abc123",
        },
        context: {
          cwd: "/path/to/project",
          repo: "github.com/owner/repo",
        },
      };

      const result = JournalQueueEntrySchema(entry);
      expect(result instanceof type.errors).toBe(false);
    });

    test("accepts valid manual entry", () => {
      const entry = {
        version: "1",
        timestamp: "2026-02-13T12:00:00Z",
        harness: "manual",
        retrieval: {
          method: "file",
        },
        context: {
          cwd: "/path/to/project",
        },
      };

      const result = JournalQueueEntrySchema(entry);
      expect(result instanceof type.errors).toBe(false);
    });

    test("rejects invalid version", () => {
      const entry = {
        version: "2",
        timestamp: "2026-02-13T12:00:00Z",
        harness: "amp",
        retrieval: { method: "amp-thread", threadId: "T-123" },
        context: { cwd: "/path" },
      };

      const result = JournalQueueEntrySchema(entry);
      expect(result instanceof type.errors).toBe(true);
    });

    test("rejects invalid harness", () => {
      const entry = {
        version: "1",
        timestamp: "2026-02-13T12:00:00Z",
        harness: "invalid",
        retrieval: { method: "file" },
        context: { cwd: "/path" },
      };

      const result = JournalQueueEntrySchema(entry);
      expect(result instanceof type.errors).toBe(true);
    });

    test("rejects missing required fields", () => {
      const entry = {
        version: "1",
        // missing timestamp
        harness: "amp",
        retrieval: { method: "file" },
        context: { cwd: "/path" },
      };

      const result = JournalQueueEntrySchema(entry);
      expect(result instanceof type.errors).toBe(true);
    });
  });

  describe("MemoryEntryMeta", () => {
    test("interface has expected fields", () => {
      const meta: MemoryEntryMeta = {
        id: "id__abc123",
        title: "Test Entry",
        tags: ["topic__test"],
        createdAt: 1707849600000,
        updatedAt: 1707849600000,
      };

      expect(meta.id).toBe("id__abc123");
      expect(meta.title).toBe("Test Entry");
      expect(meta.tags).toEqual(["topic__test"]);
      expect(meta.createdAt).toBe(1707849600000);
      expect(meta.updatedAt).toBe(1707849600000);
    });

    test("optional fields are valid", () => {
      const meta: MemoryEntryMeta = {
        id: "id__abc123",
        title: "Test Entry",
        tags: [],
        createdAt: 1707849600000,
        updatedAt: 1707849600000,
        sources: { harness: "amp", threadId: "T-123" },
        org: "axiom",
      };

      expect(meta.sources?.harness).toBe("amp");
      expect(meta.org).toBe("axiom");
    });
  });
});
