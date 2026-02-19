import { describe, test, expect } from "bun:test";
import { extractLinks, replaceLink } from "../src/links.js";

describe("extractLinks", () => {
  test("extracts full form [[id|text]]", () => {
    const links = extractLinks("see [[id__abc123|my note]] for details");
    expect(links).toHaveLength(1);
    expect(links[0]!.id).toBe("id__abc123");
    expect(links[0]!.displayText).toBe("my note");
  });

  test("extracts short form [[id]]", () => {
    const links = extractLinks("see [[id__abc123]] for details");
    expect(links).toHaveLength(1);
    expect(links[0]!.id).toBe("id__abc123");
    expect(links[0]!.displayText).toBe("id__abc123");
  });

  test("extracts multiple links per line", () => {
    const links = extractLinks("[[id__aaaaaa|first]] and [[id__bbbbbb|second]]");
    expect(links).toHaveLength(2);
    expect(links[0]!.id).toBe("id__aaaaaa");
    expect(links[1]!.id).toBe("id__bbbbbb");
  });

  test("extracts links across multiple lines", () => {
    const body = "line one [[id__aaaaaa|a]]\nline two [[id__bbbbbb|b]]";
    const links = extractLinks(body);
    expect(links).toHaveLength(2);
  });

  test("tracks position correctly", () => {
    const body = "xx[[id__abc123|note]]yy";
    const links = extractLinks(body);
    expect(links[0]!.position.start).toBe(2);
    expect(links[0]!.position.end).toBe(21);
    expect(body.slice(links[0]!.position.start, links[0]!.position.end)).toBe("[[id__abc123|note]]");
  });

  test("tracks position across lines", () => {
    const body = "first line\n[[id__abc123|note]]";
    const links = extractLinks(body);
    expect(links[0]!.position.start).toBe(11); // "first line\n" = 11 chars
    expect(body.slice(links[0]!.position.start, links[0]!.position.end)).toBe("[[id__abc123|note]]");
  });

  test("ignores links inside fenced code blocks", () => {
    const body = "before\n```\n[[id__abc123|inside code]]\n```\nafter";
    const links = extractLinks(body);
    expect(links).toHaveLength(0);
  });

  test("ignores malformed links — missing closing brackets", () => {
    const links = extractLinks("[[id__abc123|broken");
    expect(links).toHaveLength(0);
  });

  test("ignores links with invalid id format", () => {
    // id must be id__ followed by exactly 6 base58 chars
    const links = extractLinks("[[not_an_id|text]]");
    expect(links).toHaveLength(0);
  });

  test("ignores ids with non-base58 chars (0, O, I, l)", () => {
    const links = extractLinks("[[id__00aaaa|text]]");
    expect(links).toHaveLength(0);
  });

  test("handles special chars in display text", () => {
    const links = extractLinks("[[id__abc123|notes: foo & bar (2024)]]");
    expect(links[0]!.displayText).toBe("notes: foo & bar (2024)");
  });

  test("handles empty display text", () => {
    const links = extractLinks("[[id__abc123|]]");
    expect(links[0]!.displayText).toBe("");
  });

  test("returns empty for no links", () => {
    expect(extractLinks("just plain text")).toEqual([]);
  });

  test("returns empty for empty body", () => {
    expect(extractLinks("")).toEqual([]);
  });
});

describe("replaceLink", () => {
  test("replaces link id, preserving display text", () => {
    const body = "see [[id__aaaaaa|my note]] for info";
    const result = replaceLink(body, "id__aaaaaa", "id__bbbbbb");
    expect(result).toBe("see [[id__bbbbbb|my note]] for info");
  });

  test("replaces short form links", () => {
    const body = "see [[id__aaaaaa]] for info";
    const result = replaceLink(body, "id__aaaaaa", "id__bbbbbb");
    expect(result).toBe("see [[id__bbbbbb]] for info");
  });

  test("replaces all occurrences", () => {
    const body = "[[id__aaaaaa|first]] and [[id__aaaaaa|second]]";
    const result = replaceLink(body, "id__aaaaaa", "id__bbbbbb");
    expect(result).toBe("[[id__bbbbbb|first]] and [[id__bbbbbb|second]]");
  });

  test("does not affect other links", () => {
    const body = "[[id__aaaaaa|a]] and [[id__cccccc|c]]";
    const result = replaceLink(body, "id__aaaaaa", "id__bbbbbb");
    expect(result).toBe("[[id__bbbbbb|a]] and [[id__cccccc|c]]");
  });

  test("no-op when oldId not found", () => {
    const body = "[[id__cccccc|c]]";
    const result = replaceLink(body, "id__aaaaaa", "id__bbbbbb");
    expect(result).toBe("[[id__cccccc|c]]");
  });
});
