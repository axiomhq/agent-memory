import { describe, test, expect } from "bun:test";
import { extractTags } from "../src/tags.js";

describe("extractTags", () => {
  test("extracts single-word tags", () => {
    expect(extractTags("#people #work")).toEqual(["people", "work"]);
  });

  test("extracts namespaced tags", () => {
    expect(extractTags("#area__work #topic__design")).toEqual(["area__work", "topic__design"]);
  });

  test("extracts tags adjacent to text", () => {
    expect(extractTags("some text #important and more #later stuff")).toEqual(["important", "later"]);
  });

  test("extracts tags on own line", () => {
    const body = "#tag1\n#tag2\n#tag3";
    expect(extractTags(body)).toEqual(["tag1", "tag2", "tag3"]);
  });

  test("deduplicates tags", () => {
    expect(extractTags("#work and also #work again")).toEqual(["work"]);
  });

  test("ignores headings (# followed by space)", () => {
    const body = "# Title\n\n#tag1\n\n## Subtitle\n\n#tag2";
    expect(extractTags(body)).toEqual(["tag1", "tag2"]);
  });

  test("ignores tags inside fenced code blocks", () => {
    const body = "#before\n\n```\n#inside_code\n```\n\n#after";
    expect(extractTags(body)).toEqual(["before", "after"]);
  });

  test("handles nested code blocks (indented fence)", () => {
    const body = "#before\n\n  ```ts\n  #inside_code\n  ```\n\n#after";
    expect(extractTags(body)).toEqual(["before", "after"]);
  });

  test("does not match mid-word hash", () => {
    expect(extractTags("foo#bar")).toEqual([]);
  });

  test("handles tags at start of line after heading", () => {
    const body = "# Title\n\n#topic__xstate #area__testing\n\nbody content";
    expect(extractTags(body)).toEqual(["topic__xstate", "area__testing"]);
  });

  test("returns empty array for no tags", () => {
    expect(extractTags("just plain text with no tags")).toEqual([]);
  });

  test("ignores URLs with fragments", () => {
    // URL fragments like https://example.com#section should not match
    // because the # is preceded by a word char (m in .com)
    expect(extractTags("see https://example.com#section for details")).toEqual([]);
  });

  test("handles empty body", () => {
    expect(extractTags("")).toEqual([]);
  });

  test("handles multiple code blocks", () => {
    const body = "#a\n```\n#b\n```\n#c\n```\n#d\n```\n#e";
    expect(extractTags(body)).toEqual(["a", "c", "e"]);
  });

  test("tags starting with underscore", () => {
    expect(extractTags("#_private")).toEqual(["_private"]);
  });
});
