/**
 * index note — a regular memory entry that links to all top-of-mind entries.
 *
 * WHY a note, not metadata: the index is just an important entry in the archive.
 * it uses wiki links ([[id|title]]) so the link graph naturally connects it
 * to top-of-mind entries. deterministic ID means defrag can overwrite it
 * idempotently on every run.
 */

import type { MemoryEntry } from "./schema.js";

export const INDEX_NOTE_ID = "id__indexx";

/**
 * build the index note body from top-of-mind entries.
 * each entry becomes a wiki link: [[id__XXXXXX|title]]
 */
export function buildIndexNote(
  topOfMind: Array<{ id: string; title: string }>,
): MemoryEntry {
  const links = topOfMind.map((e) => `- [[${e.id}|${e.title}]]`);

  const body = links.length > 0
    ? links.join("\n")
    : "_no top-of-mind entries yet._";

  return {
    meta: {
      id: INDEX_NOTE_ID,
      title: "top of mind",
      tags: [],
      org: "default",
    },
    body,
  };
}
