/**
 * AGENTS.md generator — produces hot/warm/cold tiered memory section.
 * uses sentinel comments for idempotent replacement.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { MemoryEntry, MemoryEntryMeta } from "../schema.js";

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
  hotEntries: EntryWithBody[],
  warmEntries: Array<{ meta: MemoryEntryMeta; path: string }>,
): string {
  const lines: string[] = [];

  lines.push("## memory");
  lines.push("");
  lines.push("hot-tier knowledge, always in context.");
  lines.push("");

  if (hotEntries.length > 0) {
    for (const entry of hotEntries) {
      lines.push(`### ${entry.meta.title}`);
      lines.push("");
      lines.push(entry.body.trim());
      lines.push("");
    }
  } else {
    lines.push("_no hot-tier entries yet._");
    lines.push("");
  }

  if (warmEntries.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("### warm-tier");
    lines.push("");
    for (const entry of warmEntries) {
      const tags = entry.meta.tags?.length ? ` [${entry.meta.tags.join(", ")}]` : "";
      lines.push(`- \`${entry.meta.id}\`: ${entry.meta.title}${tags}`);
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

export interface TierAssignment {
  hotIds: string[];
  warmIds: string[];
}

export function assignTiers(
  entries: MemoryEntryMeta[],
  hotIds: string[],
  warmIds: string[],
): { hot: MemoryEntryMeta[]; warm: MemoryEntryMeta[]; cold: MemoryEntryMeta[] } {
  const hotSet = new Set(hotIds);
  const warmSet = new Set(warmIds);

  const hot: MemoryEntryMeta[] = [];
  const warm: MemoryEntryMeta[] = [];
  const cold: MemoryEntryMeta[] = [];

  for (const entry of entries) {
    if (hotSet.has(entry.id)) {
      hot.push(entry);
    } else if (warmSet.has(entry.id)) {
      warm.push(entry);
    } else {
      cold.push(entry);
    }
  }

  return { hot, warm, cold };
}
