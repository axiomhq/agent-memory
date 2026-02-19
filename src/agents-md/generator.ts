/**
 * AGENTS.md generator — produces memory section with top-of-mind inlined
 * and all other entries listed as [title](id__XXXXXX).
 *
 * uses sentinel comments for idempotent replacement.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import type { MemoryEntryMeta } from "../schema.js";

const SECTION_START = "<!-- agent-memory:start -->";
const SECTION_END = "<!-- agent-memory:end -->";

export interface EntryWithBody {
  meta: MemoryEntryMeta;
  body: string;
}

/**
 * generates the memory section content.
 *
 * topOfMindEntries: inlined fully as `## title - id__XXXXXX` + body
 * archiveEntries: listed as `- [title](id__XXXXXX)`
 *
 * top-of-mind entries are NOT included in the archive list.
 */
export function generateAgentsMdSection(
  topOfMindEntries: EntryWithBody[],
  archiveEntries: MemoryEntryMeta[],
): string {
  const lines: string[] = [];

  if (topOfMindEntries.length > 0) {
    for (const entry of topOfMindEntries) {
      lines.push(`## ${entry.meta.title} - ${entry.meta.id}`);
      lines.push("");
      lines.push(entry.body.trim());
      lines.push("");
    }
  }

  if (archiveEntries.length > 0) {
    if (topOfMindEntries.length > 0) {
      lines.push("---");
      lines.push("");
    }

    for (const entry of archiveEntries) {
      lines.push(`- [${entry.title}](${entry.id})`);
    }
    lines.push("");
  }

  if (topOfMindEntries.length === 0 && archiveEntries.length === 0) {
    lines.push("_no memory entries yet._");
    lines.push("");
  }

  return lines.join("\n");
}

export function wrapInSection(content: string): string {
  return `${SECTION_START}\n${content}\n${SECTION_END}`;
}

export function replaceAgentsMdSection(targetPath: string, newSection: string): void {
  const wrapped = wrapInSection(newSection);

  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, wrapped, "utf-8");
    return;
  }

  const existing = readFileSync(targetPath, "utf-8");
  const startIdx = existing.indexOf(SECTION_START);
  const endIdx = existing.indexOf(SECTION_END);

  if (startIdx === -1 || endIdx === -1) {
    const updated = existing.trimEnd() + "\n\n" + wrapped + "\n";
    writeFileSync(targetPath, updated, "utf-8");
    return;
  }

  const before = existing.slice(0, startIdx);
  const after = existing.slice(endIdx + SECTION_END.length);
  const updated = before + wrapped + after;
  writeFileSync(targetPath, updated, "utf-8");
}
