import { describe, test, expect } from "bun:test";
import { type } from "arktype";
import { JournalQueueEntrySchema, MemoryEntryMetaSchema } from "../src/schema.js";

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

  describe("MemoryEntryMetaSchema", () => {
    const validMeta = {
      id: "id__abc123",
      title: "Test Entry",
      status: "captured",
      used: 0,
      last_used: "2026-02-13T12:00:00Z",
      org: "default",
      createdAt: 1707849600000,
      updatedAt: 1707849600000,
    };

    test("accepts valid entry", () => {
      const result = MemoryEntryMetaSchema(validMeta);
      expect(result instanceof type.errors).toBe(false);
    });

    test("accepts all valid status values", () => {
      for (const status of ["captured", "consolidated", "promoted"] as const) {
        const result = MemoryEntryMetaSchema({ ...validMeta, status });
        expect(result instanceof type.errors).toBe(false);
      }
    });

    test("accepts optional fields", () => {
      const withOptional = {
        ...validMeta,
        tags: ["topic__test", "area__demo"],
        sources: { harness: "amp", threadId: "T-123" },
      };

      const result = MemoryEntryMetaSchema(withOptional);
      expect(result instanceof type.errors).toBe(false);
    });

    test("rejects invalid id format", () => {
      const result = MemoryEntryMetaSchema({ ...validMeta, id: "invalid" });
      expect(result instanceof type.errors).toBe(true);
    });

    test("rejects invalid status", () => {
      const result = MemoryEntryMetaSchema({ ...validMeta, status: "invalid" });
      expect(result instanceof type.errors).toBe(true);
    });

    test("rejects negative used count", () => {
      const result = MemoryEntryMetaSchema({ ...validMeta, used: -1 });
      expect(result instanceof type.errors).toBe(true);
    });

    test("rejects empty title", () => {
      const result = MemoryEntryMetaSchema({ ...validMeta, title: "" });
      expect(result instanceof type.errors).toBe(true);
    });
  });
});
