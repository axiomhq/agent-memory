/**
 * AGENTS.md generator — produces top-of-mind + archive list section.
 * uses sentinel comments for idempotent replacement.
 * uses [[id|text]] wiki-link format for entry references.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import type { MemoryEntryMeta } from "../schema.js";

const SECTION_START = "<!-- agent-memory:start -->";
const SECTION_END = "<!-- agent-memory:end -->";

export interface AgentsMdOptions {
  targets: string[];
}

export interface EntryWithBody {
  meta: MemoryEntryMeta;
  body: string;
}

export function generateAgentsMdSection(
  topOfMindEntries: EntryWithBody[],
  allEntries: MemoryEntryMeta[],
): string {
  const lines: string[] = [];
  const topOfMindIds = new Set(topOfMindEntries.map((e) => e.meta.id));

  lines.push("## memory");
  lines.push("");

  if (topOfMindEntries.length > 0) {
    for (const entry of topOfMindEntries) {
      lines.push(`## ${entry.meta.title} - ${entry.meta.id}`);
      lines.push("");
      lines.push(entry.body.trim());
      lines.push("");
    }
  } else {
    lines.push("_no top-of-mind entries yet._");
    lines.push("");
  }

  const otherEntries = allEntries.filter((e) => !topOfMindIds.has(e.id));

  if (otherEntries.length > 0) {
    for (const entry of otherEntries) {
      lines.push(`- [[${entry.id}|${entry.title}]]`);
    }
    lines.push("");
  }

  lines.push("browse all: `memory list` | read: `memory read <id>`");

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
