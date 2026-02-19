import { describe, it, expect } from "bun:test";
import {
  buildDefragPrompt,
  parseDefragOutput,
  type EntryForDefrag,
} from "../src/prompts/defrag.js";

describe("buildDefragPrompt", () => {
  it("includes entry id, title, and body", () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__abc123",
        title: "test entry",
        body: "some content here",
        tags: [],
      },
    ];

    const prompt = buildDefragPrompt(entries);

    expect(prompt).toContain("id__abc123");
    expect(prompt).toContain("test entry");
    expect(prompt).toContain("some content here");
  });

  it("includes tags when present", () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__abc123",
        title: "tagged entry",
        body: "content",
        tags: ["topic__foo", "area__bar"],
      },
    ];

    const prompt = buildDefragPrompt(entries);

    expect(prompt).toContain("[topic__foo, area__bar]");
  });

  it("truncates body beyond 500 chars with ellipsis", () => {
    const longBody = "x".repeat(600);
    const entries: EntryForDefrag[] = [
      {
        id: "id__long",
        title: "long entry",
        body: longBody,
        tags: [],
      },
    ];

    const prompt = buildDefragPrompt(entries);

    expect(prompt).toContain("x".repeat(500) + "...");
    expect(prompt).not.toContain("x".repeat(600));
  });

  it("includes tiering instructions with top-of-mind binary model", () => {
    const prompt = buildDefragPrompt([]);

    expect(prompt).toContain("Top of mind");
    expect(prompt).toContain("Everything else");
    expect(prompt).toContain("foundational");
    expect(prompt).toContain("content relevance");
  });

  it("does not reference dead fields (used, last_used, pinned)", () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__abc123",
        title: "test",
        body: "content",
        tags: [],
      },
    ];

    const prompt = buildDefragPrompt(entries);

    expect(prompt).not.toContain("used:");
    expect(prompt).not.toContain("last_used:");
    expect(prompt).not.toContain("pinned:");
    expect(prompt).not.toContain("used counter");
    expect(prompt).not.toContain("pinned: true is a strong signal");
  });

  it("includes all action types in JSON schema", () => {
    const prompt = buildDefragPrompt([]);

    expect(prompt).toContain('"type": "merge"');
    expect(prompt).toContain('"type": "split"');
    expect(prompt).toContain('"type": "rename"');
    expect(prompt).toContain('"type": "archive"');
    expect(prompt).toContain('"type": "update-tags"');
  });

  it("includes goals section", () => {
    const prompt = buildDefragPrompt([]);

    expect(prompt).toContain("Target 15-25 focused files");
    expect(prompt).toContain("Max ~40 lines per file");
    expect(prompt).toContain("Detect duplicates/overlaps");
  });

  it("separates multiple entries with dividers", () => {
    const entries: EntryForDefrag[] = [
      {
        id: "id__one",
        title: "first",
        body: "content one",
        tags: [],
      },
      {
        id: "id__two",
        title: "second",
        body: "content two",
        tags: [],
      },
    ];

    const prompt = buildDefragPrompt(entries);

    expect(prompt).toContain("---");
    expect(prompt).toContain("id__one");
    expect(prompt).toContain("id__two");
  });
});

describe("parseDefragOutput", () => {
  it("parses valid JSON object with actions and topOfMind", () => {
    const raw = JSON.stringify({
      actions: [],
      topOfMind: ["id__aaa111", "id__bbb222"],
    });

    const result = parseDefragOutput(raw);

    expect(result.actions).toEqual([]);
    expect(result.topOfMind).toEqual(["id__aaa111", "id__bbb222"]);
  });

  it("strips markdown code fence with json", () => {
    const raw = '```json\n{"actions": [], "topOfMind": []}\n```';

    const result = parseDefragOutput(raw);

    expect(result.actions).toEqual([]);
  });

  it("strips code fence without language", () => {
    const raw = '```\n{"actions": [], "topOfMind": []}\n```';

    const result = parseDefragOutput(raw);

    expect(result.actions).toEqual([]);
  });

  it("parses merge action", () => {
    const raw = JSON.stringify({
      actions: [
        {
          type: "merge",
          sources: ["id__abc", "id__def"],
          title: "merged title",
          body: "merged body",
          tags: ["topic__x"],
        },
      ],
      topOfMind: [],
    });

    const result = parseDefragOutput(raw);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toEqual({
      type: "merge",
      sources: ["id__abc", "id__def"],
      title: "merged title",
      body: "merged body",
      tags: ["topic__x"],
    });
  });

  it("parses split action", () => {
    const raw = JSON.stringify({
      actions: [
        {
          type: "split",
          source: "id__big",
          entries: [
            { title: "part 1", body: "body 1", tags: ["topic__a"] },
            { title: "part 2", body: "body 2", tags: [] },
          ],
        },
      ],
      topOfMind: [],
    });

    const result = parseDefragOutput(raw);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toEqual({
      type: "split",
      source: "id__big",
      entries: [
        { title: "part 1", body: "body 1", tags: ["topic__a"] },
        { title: "part 2", body: "body 2", tags: [] },
      ],
    });
  });

  it("parses rename action", () => {
    const raw = JSON.stringify({
      actions: [{ type: "rename", id: "id__old", newTitle: "better title" }],
      topOfMind: [],
    });

    const result = parseDefragOutput(raw);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toEqual({
      type: "rename",
      id: "id__old",
      newTitle: "better title",
    });
  });

  it("parses archive action", () => {
    const raw = JSON.stringify({
      actions: [{ type: "archive", id: "id__old", reason: "superseded" }],
      topOfMind: [],
    });

    const result = parseDefragOutput(raw);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toEqual({
      type: "archive",
      id: "id__old",
      reason: "superseded",
    });
  });

  it("parses update-tags action", () => {
    const raw = JSON.stringify({
      actions: [{ type: "update-tags", id: "id__x", tags: ["topic__y", "area__z"] }],
      topOfMind: [],
    });

    const result = parseDefragOutput(raw);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toEqual({
      type: "update-tags",
      id: "id__x",
      tags: ["topic__y", "area__z"],
    });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDefragOutput("not json")).toThrow(
      "defrag output is not valid JSON",
    );
  });

  it("throws on array input", () => {
    expect(() => parseDefragOutput('["array"]')).toThrow(
      "defrag output missing 'actions' array",
    );
  });

  it("throws on missing actions field", () => {
    expect(() => parseDefragOutput('{"topOfMind": []}')).toThrow(
      "defrag output missing 'actions' array",
    );
  });

  it("throws on missing topOfMind field", () => {
    expect(() => parseDefragOutput('{"actions": []}')).toThrow(
      "defrag output missing 'topOfMind' array",
    );
  });

  it("throws on unknown action type", () => {
    const raw = JSON.stringify({
      actions: [{ type: "unknown" }],
      topOfMind: [],
    });

    expect(() => parseDefragOutput(raw)).toThrow("unknown action type: unknown");
  });

  it("throws on merge without sources", () => {
    const raw = JSON.stringify({
      actions: [{ type: "merge", title: "t", body: "b", tags: [] }],
      topOfMind: [],
    });

    expect(() => parseDefragOutput(raw)).toThrow(
      "merge action 0 missing required fields",
    );
  });

  it("throws on merge without title", () => {
    const raw = JSON.stringify({
      actions: [{ type: "merge", sources: ["id__a"], body: "b", tags: [] }],
      topOfMind: [],
    });

    expect(() => parseDefragOutput(raw)).toThrow(
      "merge action 0 missing required fields",
    );
  });

  it("throws on split without source", () => {
    const raw = JSON.stringify({
      actions: [{ type: "split", entries: [] }],
      topOfMind: [],
    });

    expect(() => parseDefragOutput(raw)).toThrow(
      "split action 0 missing required fields",
    );
  });

  it("throws on rename without id", () => {
    const raw = JSON.stringify({
      actions: [{ type: "rename", newTitle: "new" }],
      topOfMind: [],
    });

    expect(() => parseDefragOutput(raw)).toThrow(
      "rename action 0 missing required fields",
    );
  });

  it("throws on archive without reason", () => {
    const raw = JSON.stringify({
      actions: [{ type: "archive", id: "id__x" }],
      topOfMind: [],
    });

    expect(() => parseDefragOutput(raw)).toThrow(
      "archive action 0 missing required fields",
    );
  });

  it("throws on update-tags without tags", () => {
    const raw = JSON.stringify({
      actions: [{ type: "update-tags", id: "id__x" }],
      topOfMind: [],
    });

    expect(() => parseDefragOutput(raw)).toThrow(
      "update-tags action 0 missing required fields",
    );
  });

  it("filters non-string ids from topOfMind", () => {
    const raw = JSON.stringify({
      actions: [],
      topOfMind: ["id__valid", 123, null, "id__also-valid"],
    });

    const result = parseDefragOutput(raw);

    expect(result.topOfMind).toEqual(["id__valid", "id__also-valid"]);
  });

  it("filters non-string tags from merge action", () => {
    const raw = JSON.stringify({
      actions: [
        {
          type: "merge",
          sources: ["id__a"],
          title: "t",
          body: "b",
          tags: ["valid", 123, null, "also-valid"],
        },
      ],
      topOfMind: [],
    });

    const result = parseDefragOutput(raw);

    expect(result.actions[0]).toEqual({
      type: "merge",
      sources: ["id__a"],
      title: "t",
      body: "b",
      tags: ["valid", "also-valid"],
    });
  });

  it("filters non-string tags from update-tags action", () => {
    const raw = JSON.stringify({
      actions: [{ type: "update-tags", id: "id__x", tags: ["a", 1, "b", null] }],
      topOfMind: [],
    });

    const result = parseDefragOutput(raw);

    expect(result.actions[0]).toEqual({
      type: "update-tags",
      id: "id__x",
      tags: ["a", "b"],
    });
  });

  it("handles merge with missing tags field", () => {
    const raw = JSON.stringify({
      actions: [{ type: "merge", sources: ["id__a"], title: "t", body: "b" }],
      topOfMind: [],
    });

    const result = parseDefragOutput(raw);

    expect(result.actions[0]).toEqual({
      type: "merge",
      sources: ["id__a"],
      title: "t",
      body: "b",
      tags: [],
    });
  });

  it("filters non-string sources from merge action", () => {
    const raw = JSON.stringify({
      actions: [
        {
          type: "merge",
          sources: ["id__a", 123, "id__b"],
          title: "t",
          body: "b",
          tags: [],
        },
      ],
      topOfMind: [],
    });

    const result = parseDefragOutput(raw);

    expect(result.actions[0]).toEqual({
      type: "merge",
      sources: ["id__a", "id__b"],
      title: "t",
      body: "b",
      tags: [],
    });
  });

  it("throws on non-object action", () => {
    const raw = JSON.stringify({
      actions: ["not an object"],
      topOfMind: [],
    });

    expect(() => parseDefragOutput(raw)).toThrow("action 0 must be an object");
  });

  it("throws on action missing type", () => {
    const raw = JSON.stringify({
      actions: [{ id: "id__x" }],
      topOfMind: [],
    });

    expect(() => parseDefragOutput(raw)).toThrow("action 0 missing type");
  });
});
