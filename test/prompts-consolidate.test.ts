import { describe, it, expect } from "bun:test";
import {
  buildConsolidationPrompt,
  parseConsolidationOutput,
  resolveIntraBatchLinks,
  type JournalForPrompt,
  type ExistingEntryRef,
} from "../src/prompts/consolidate.js";

describe("buildConsolidationPrompt", () => {
  it("produces prompt with journals and no existing entries", () => {
    const journals: JournalForPrompt[] = [
      { id: "q__abc123", title: "test entry", body: "some content", tags: ["topic__test"] },
    ];
    const existing: ExistingEntryRef[] = [];

    const prompt = buildConsolidationPrompt(journals, existing);

    expect(prompt).toContain("q__abc123");
    expect(prompt).toContain("test entry");
    expect(prompt).toContain("some content");
    expect(prompt).toContain("topic__test");
    expect(prompt).toContain("(none yet)");
  });

  it("produces prompt with journals and existing entries", () => {
    const journals: JournalForPrompt[] = [
      { id: "q__abc123", title: "new entry", body: "new content", tags: [] },
    ];
    const existing: ExistingEntryRef[] = [
      { id: "id__xyz789", title: "existing knowledge", tags: ["topic__foo"] },
    ];

    const prompt = buildConsolidationPrompt(journals, existing);

    expect(prompt).toContain("id__xyz789");
    expect(prompt).toContain("existing knowledge");
    expect(prompt).toContain("topic__foo");
  });

  it("handles journal without tags", () => {
    const journals: JournalForPrompt[] = [
      { id: "q__abc123", title: "untagged", body: "content", tags: [] },
    ];
    const existing: ExistingEntryRef[] = [];

    const prompt = buildConsolidationPrompt(journals, existing);

    expect(prompt).toContain("untagged");
    expect(prompt).not.toContain("(tags: )");
  });

  it("includes zettelkasten instructions", () => {
    const prompt = buildConsolidationPrompt([], []);

    expect(prompt).toContain("zettelkasten");
    expect(prompt).toContain("[[id__XXXXXX]]");
    expect(prompt).toContain("SINGLE concept");
  });

  it("includes thread history when provided", () => {
    const journals: JournalForPrompt[] = [
      { id: "q__abc123", title: "test entry", body: "some content", tags: [] },
    ];
    const history = "## Thread T-abc\n\nUser: fix the auth bug\nAssistant: done";

    const prompt = buildConsolidationPrompt(journals, [], history);

    expect(prompt).toContain("Thread history");
    expect(prompt).toContain("fix the auth bug");
  });

  it("omits thread history section when empty", () => {
    const journals: JournalForPrompt[] = [
      { id: "q__abc123", title: "test entry", body: "some content", tags: [] },
    ];

    const prompt = buildConsolidationPrompt(journals, [], "");

    expect(prompt).not.toContain("Thread history");
  });

  it("omits thread history section when undefined", () => {
    const prompt = buildConsolidationPrompt([], []);

    expect(prompt).not.toContain("Thread history");
  });
});

describe("parseConsolidationOutput", () => {
  it("parses valid JSON array", () => {
    const raw = JSON.stringify([
      { title: "entry 1", body: "body 1", tags: ["topic__a"] },
      { title: "entry 2", body: "body 2", tags: [] },
    ]);

    const result = parseConsolidationOutput(raw);

    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe("entry 1");
    expect(result[0]!.body).toBe("body 1");
    expect(result[0]!.tags).toEqual(["topic__a"]);
    expect(result[1]!.tags).toEqual([]);
  });

  it("strips markdown code fence", () => {
    const raw = "```json\n[{\"title\": \"t\", \"body\": \"b\", \"tags\": []}]\n```";

    const result = parseConsolidationOutput(raw);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("t");
  });

  it("strips code fence without language", () => {
    const raw = "```\n[{\"title\": \"t\", \"body\": \"b\", \"tags\": []}]\n```";

    const result = parseConsolidationOutput(raw);

    expect(result).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    const result = parseConsolidationOutput("[]");

    expect(result).toEqual([]);
  });

  it("extracts JSON from prose preamble", () => {
    const raw = `The two journal entries map to threads T-abc and T-def. Here are the extracted notes:

[{"title": "auth gotcha", "body": "webhook needs raw body", "tags": ["topic__auth"]}]`;

    const result = parseConsolidationOutput(raw);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("auth gotcha");
  });

  it("extracts JSON from prose preamble and epilogue", () => {
    const raw = `Here are the notes:\n\n[{"title": "t", "body": "b", "tags": []}]\n\nLet me know if you need changes.`;

    const result = parseConsolidationOutput(raw);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("t");
  });

  it("extracts JSON from markdown code fence mid-text", () => {
    const raw = `Here are the entries:\n\n\`\`\`json\n[{"title": "t", "body": "b", "tags": []}]\n\`\`\`\n\nDone.`;

    const result = parseConsolidationOutput(raw);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("t");
  });

  it("extracts empty array from prose containing [[wiki-links]]", () => {
    const raw = `All three threads contain already-covered knowledge (entries like [[id__439Y7t]], [[id__CewF7J]], [[id__AbkZ5V]]). Nothing new to extract.

[]`;

    const result = parseConsolidationOutput(raw);

    expect(result).toEqual([]);
  });

  it("extracts entries from prose containing [[wiki-links]]", () => {
    const raw = `Based on existing entries [[id__abc123]] and [[id__def456]], here is one new note:

[{"title": "new pattern", "body": "see also [[id__abc123]]", "tags": ["topic__test"]}]`;

    const result = parseConsolidationOutput(raw);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("new pattern");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseConsolidationOutput("not json")).toThrow(
      "agent output is not valid JSON",
    );
  });

  it("throws on non-array", () => {
    expect(() => parseConsolidationOutput('{"foo": "bar"}')).toThrow(
      "agent output is not an array",
    );
  });

  it("throws on entry missing title", () => {
    expect(() => parseConsolidationOutput('[{"body": "b", "tags": []}]')).toThrow(
      "entry 0 missing required fields",
    );
  });

  it("throws on entry missing body", () => {
    expect(() => parseConsolidationOutput('[{"title": "t", "tags": []}]')).toThrow(
      "entry 0 missing required fields",
    );
  });

  it("coerces non-string tags to empty", () => {
    const raw = JSON.stringify([
      { title: "t", body: "b", tags: [1, "valid", null, "also-valid"] },
    ]);

    const result = parseConsolidationOutput(raw);

    expect(result[0]!.tags).toEqual(["valid", "also-valid"]);
  });

  it("handles missing tags field", () => {
    const raw = JSON.stringify([{ title: "t", body: "b" }]);

    const result = parseConsolidationOutput(raw);

    expect(result[0]!.tags).toEqual([]);
  });
});

describe("resolveIntraBatchLinks", () => {
  it("resolves pending links by title", () => {
    const entries = [
      { title: "First Entry", body: "content [[pending:second entry]]", id: "id__aaa111" },
      { title: "Second Entry", body: "content [[pending:first entry]]", id: "id__bbb222" },
    ];

    const resolved = resolveIntraBatchLinks(entries);

    expect(resolved[0]!.body).toBe("content [[id__bbb222]]");
    expect(resolved[1]!.body).toBe("content [[id__aaa111]]");
  });

  it("leaves unresolved pending links intact", () => {
    const entries = [
      { title: "Only Entry", body: "see [[pending:missing entry]]", id: "id__aaa111" },
    ];

    const resolved = resolveIntraBatchLinks(entries);

    expect(resolved[0]!.body).toBe("see [[pending:missing entry]]");
  });

  it("handles case-insensitive title matching", () => {
    const entries = [
      { title: "Important Pattern", body: "see [[pending:IMPORTANT PATTERN]]", id: "id__aaa111" },
    ];

    const resolved = resolveIntraBatchLinks(entries);

    expect(resolved[0]!.body).toBe("see [[id__aaa111]]");
  });

  it("preserves regular id links", () => {
    const entries = [
      { title: "Entry", body: "see [[id__xyz789]] for more", id: "id__aaa111" },
    ];

    const resolved = resolveIntraBatchLinks(entries);

    expect(resolved[0]!.body).toBe("see [[id__xyz789]] for more");
  });

  it("resolves multiple pending links in one body", () => {
    const entries = [
      { title: "A", body: "", id: "id__aaa111" },
      { title: "B", body: "", id: "id__bbb222" },
      { title: "C", body: "links: [[pending:a]] and [[pending:b]]", id: "id__ccc333" },
    ];

    const resolved = resolveIntraBatchLinks(entries);

    expect(resolved[2]!.body).toBe("links: [[id__aaa111]] and [[id__bbb222]]");
  });
});
