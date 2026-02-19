/**
 * memory entry serialization — pure markdown, no metadata header.
 *
 * format:
 *   # Title
 *
 *   #tag1 #tag2
 *
 *   body content here
 *
 * WHY pure markdown: tool-agnostic, human-readable, grep-friendly.
 * metadata is derived at read time from filename + body + git history.
 */

import { ok, err, type Result } from "neverthrow";
import type { MemoryEntry } from "./schema.js";

export type FormatError = { _tag: "format.parse"; path: string; message: string };

/**
 * serialize a memory entry to pure markdown.
 * produces: # title, optional #tag line, body.
 */
export function serializeMemoryMarkdown(title: string, tags: string[], body: string): string {
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push("");

  if (tags.length > 0) {
    lines.push(tags.map((t) => `#${t}`).join(" "));
    lines.push("");
  }

  if (body.trim()) {
    lines.push(body.trim());
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * parse a pure markdown memory entry.
 * extracts title from first # heading. id must be provided by caller (from filename).
 * tags are extracted separately via extractTags (US-002).
 */
export function parseMemoryMarkdown(
  text: string,
  sourcePath: string,
  id: string,
): Result<{ title: string; body: string }, FormatError> {
  const lines = text.split("\n");

  let title = "";
  let titleLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      title = match[1]!.trim();
      titleLineIndex = i;
      break;
    }
  }

  if (!title) {
    return err({
      _tag: "format.parse",
      path: sourcePath,
      message: "no # heading found in entry",
    });
  }

  // body is everything after the title line, trimmed
  const bodyLines = lines.slice(titleLineIndex + 1);
  const body = bodyLines.join("\n").trim();

  return ok({ title, body });
}
