import { describe, test, expect } from "bun:test";
import { serializeMemoryMarkdown, parseMemoryMarkdown } from "../src/format.js";

describe("format", () => {
  describe("serializeMemoryMarkdown", () => {
    test("produces pure markdown with heading", () => {
      const result = serializeMemoryMarkdown("Test Entry", [], "This is the body content.");

      expect(result).toContain("# Test Entry");
      expect(result).toContain("This is the body content.");
      expect(result).not.toContain("<!-- agent-memory:meta");
    });

    test("includes inline tags", () => {
      const result = serializeMemoryMarkdown("Test Entry", ["topic__xstate", "area__testing"], "body");

      expect(result).toContain("#topic__xstate #area__testing");
    });

    test("omits tag line when no tags", () => {
      const result = serializeMemoryMarkdown("Test Entry", [], "body");

      const lines = result.split("\n");
      expect(lines[0]).toBe("# Test Entry");
      expect(lines[1]).toBe("");
      expect(lines[2]).toBe("body");
    });

    test("handles empty body", () => {
      const result = serializeMemoryMarkdown("Title Only", ["tag"], "");

      expect(result).toContain("# Title Only");
      expect(result).toContain("#tag");
    });
  });

  describe("parseMemoryMarkdown", () => {
    test("roundtrips serialize/parse", () => {
      const serialized = serializeMemoryMarkdown("Test Entry", ["topic__test"], "Test body content\n\nwith multiple lines.");
      const parsed = parseMemoryMarkdown(serialized, "test.md", "id__abc123");

      expect(parsed.isOk()).toBe(true);
      if (parsed.isOk()) {
        expect(parsed.value.title).toBe("Test Entry");
        expect(parsed.value.body).toContain("Test body content");
        expect(parsed.value.body).toContain("with multiple lines.");
      }
    });

    test("extracts title from # heading", () => {
      const text = "# My Title\n\nSome body here.";
      const result = parseMemoryMarkdown(text, "test.md", "id__abc123");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.title).toBe("My Title");
      }
    });

    test("fails on missing heading", () => {
      const result = parseMemoryMarkdown("no heading here", "test.md", "id__abc123");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error._tag).toBe("format.parse");
        expect(result.error.message).toContain("no # heading found");
      }
    });

    test("body is everything after title", () => {
      const text = "# Title\n\n#tag1 #tag2\n\nBody paragraph.\n\nAnother paragraph.";
      const result = parseMemoryMarkdown(text, "test.md", "id__abc123");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.body).toContain("#tag1 #tag2");
        expect(result.value.body).toContain("Body paragraph.");
        expect(result.value.body).toContain("Another paragraph.");
      }
    });
  });
});
