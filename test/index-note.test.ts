import { describe, it, expect } from "bun:test";
import { INDEX_NOTE_ID, buildIndexNote } from "../src/index-note.js";
import { isValidId } from "../src/id.js";
import { extractLinks } from "../src/links.js";

describe("index note", () => {
  it("INDEX_NOTE_ID is a valid entry id", () => {
    expect(isValidId(INDEX_NOTE_ID)).toBe(true);
  });

  it("INDEX_NOTE_ID is deterministic", () => {
    expect(INDEX_NOTE_ID).toBe("id__ndxTop");
  });

  it("builds note with wiki links to top-of-mind entries", () => {
    const entries = [
      { id: "id__abc123", title: "auth patterns" },
      { id: "id__def456", title: "error handling" },
    ];

    const note = buildIndexNote(entries);

    expect(note.meta.id).toBe(INDEX_NOTE_ID);
    expect(note.meta.title).toBe("top of mind");
    expect(note.body).toContain("[[id__abc123|auth patterns]]");
    expect(note.body).toContain("[[id__def456|error handling]]");
  });

  it("wiki links in body are extractable by links module", () => {
    const entries = [
      { id: "id__abc123", title: "auth patterns" },
      { id: "id__def456", title: "error handling" },
    ];

    const note = buildIndexNote(entries);
    const links = extractLinks(note.body);

    expect(links).toHaveLength(2);
    expect(links[0]!.id).toBe("id__abc123");
    expect(links[0]!.displayText).toBe("auth patterns");
    expect(links[1]!.id).toBe("id__def456");
    expect(links[1]!.displayText).toBe("error handling");
  });

  it("builds placeholder body when no entries", () => {
    const note = buildIndexNote([]);

    expect(note.body).toContain("_no top-of-mind entries yet._");
  });

  it("uses default org", () => {
    const note = buildIndexNote([]);

    expect(note.meta.org).toBe("default");
  });

  it("has empty tags", () => {
    const note = buildIndexNote([]);

    expect(note.meta.tags).toEqual([]);
  });
});
