import { describe, test, expect } from "bun:test";
import { serializeMemoryMarkdown, parseMemoryMarkdown } from "../src/format.js";
import type { MemoryEntryMeta } from "../src/schema.js";

const createMeta = (overrides: Partial<MemoryEntryMeta> = {}): MemoryEntryMeta => ({
  id: "id__abc123",
  title: "Test Entry",
  status: "captured",
  used: 0,
  last_used: "2026-02-13T12:00:00Z",
  org: "default",
  createdAt: 1707849600000,
  updatedAt: 1707849600000,
  ...overrides,
});

describe("format", () => {
  describe("serializeMemoryMarkdown", () => {
    test("produces valid markdown with metadata header", () => {
      const meta = createMeta();
      const body = "This is the body content.";
      const result = serializeMemoryMarkdown(meta, body);

      expect(result).toContain("<!-- agent-memory:meta");
      expect(result).toContain("-->");
      expect(result).toContain('"id": "id__abc123"');
      expect(result).toContain("This is the body content.");
    });

    test("escapes --> in JSON content", () => {
      const meta = createMeta({ title: "Test --> Arrow" });
      const body = "body content";
      const result = serializeMemoryMarkdown(meta, body);

      // The escape happens in the JSON, not the markdown body
      expect(result).toContain("Test --\\u003E Arrow");
    });

    test("includes all metadata fields", () => {
      const meta = createMeta({
        tags: ["topic__xstate", "area__testing"],
        sources: { harness: "amp", threadId: "T-123" },
      });
      const result = serializeMemoryMarkdown(meta, "body");

      expect(result).toContain('"tags"');
      expect(result).toContain("topic__xstate");
      expect(result).toContain("threadId");
    });
  });

  describe("parseMemoryMarkdown", () => {
    test("roundtrips serialize/parse", () => {
      const meta = createMeta({
        tags: ["topic__test"],
        used: 5,
      });
      const body = "Test body content\n\nwith multiple lines.";

      const serialized = serializeMemoryMarkdown(meta, body);
      const parsed = parseMemoryMarkdown(serialized, "test.md");

      expect(parsed.isOk()).toBe(true);
      if (parsed.isOk()) {
        expect(parsed.value.meta.id).toBe(meta.id);
        expect(parsed.value.meta.title).toBe(meta.title);
        expect(parsed.value.meta.tags).toEqual(meta.tags);
        expect(parsed.value.meta.used).toBe(5);
        expect(parsed.value.body.trim()).toBe(body.trim());
      }
    });

    test("fails on missing header", () => {
      const result = parseMemoryMarkdown("no header here", "test.md");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error._tag).toBe("format.parse");
        expect(result.error.message).toContain("missing memory metadata header");
      }
    });

    test("fails on unterminated header", () => {
      const content = `<!-- agent-memory:meta
{"id": "id__abc123"}
no closing marker`;
      const result = parseMemoryMarkdown(content, "test.md");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("unterminated");
      }
    });

    test("fails on invalid JSON", () => {
      const content = `<!-- agent-memory:meta
{not valid json}
-->`;
      const result = parseMemoryMarkdown(content, "test.md");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("invalid JSON");
      }
    });

    test("fails on schema validation error", () => {
      const content = `<!-- agent-memory:meta
{"id": "invalid-id", "title": "Test"}
-->`;
      const result = parseMemoryMarkdown(content, "test.md");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("schema validation");
      }
    });
  });
});
