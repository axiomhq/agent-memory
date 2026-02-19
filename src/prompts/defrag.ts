/**
 * defrag prompt builder — reorganizes memory filesystem.
 * agent decides: what's top-of-mind, what to merge/split/rename/archive.
 *
 * top-of-mind replaces the old hot/warm/cold tiering.
 * entries marked top-of-mind get a `_top-of-mind` filename prefix
 * and are inlined in AGENTS.md. all others are listed by title + id.
 */

import type { MemoryEntryMeta, MemoryEntry } from "../schema.js";

export interface EntryForDefrag {
  id: string;
  title: string;
  body: string;
  tags: string[];
  used: number;
  last_used: string;
  topOfMind: boolean;
  status: MemoryEntryMeta["status"];
}

export interface DefragDecision {
  actions: DefragAction[];
  topOfMind: string[];
}

export type DefragAction =
  | { type: "merge"; sources: string[]; title: string; body: string; tags: string[] }
  | { type: "split"; source: string; entries: Array<{ title: string; body: string; tags: string[] }> }
  | { type: "rename"; id: string; newTitle: string }
  | { type: "archive"; id: string; reason: string }
  | { type: "update-tags"; id: string; tags: string[] };

export function buildDefragPrompt(entries: EntryForDefrag[]): string {
  const entriesSection = entries
    .map((e) => {
      const stats = `used: ${e.used}, last_used: ${e.last_used}, top_of_mind: ${e.topOfMind}`;
      const tags = e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : "";
      return `### ${e.id}: "${e.title}"${tags}\n${stats}\n\n${e.body.slice(0, 500)}${e.body.length > 500 ? "..." : ""}`;
    })
    .join("\n\n---\n\n");

  return `You are reorganizing a memory filesystem for an AI coding agent.

## Goals

1. **Target 15-25 focused files** — letta pattern
2. **Max ~40 lines per file** — split if larger
3. **Detect duplicates/overlaps** — merge related content
4. **Decide top-of-mind entries** for AGENTS.md generation

## Top-of-mind criteria

Entries marked top-of-mind are inlined fully in AGENTS.md — they're what the agent sees every session without any retrieval.

Mark an entry top-of-mind when it's:
- actively relevant RIGHT NOW (current project context, active patterns)
- foundational (always needed regardless of task)
- frequently accessed (\`used\` counter is high, \`last_used\` is recent)

Everything else is listed by title + id in AGENTS.md and retrievable via \`memory read <id>\`.

The \`used\` counter and \`last_used\` timestamp inform but don't dictate. Use judgment.

## Current entries

${entriesSection}

## Instructions

1. Review entries for duplicates, overlaps, or overgrown files
2. Decide what to merge, split, rename, or archive
3. Decide which entries are top-of-mind

Respond with ONLY a JSON object. No markdown fencing:

{
  "actions": [
    { "type": "merge", "sources": ["id__abc123", "id__def456"], "title": "merged title", "body": "merged body", "tags": ["topic__x"] },
    { "type": "split", "source": "id__big1", "entries": [{ "title": "part 1", "body": "...", "tags": [] }] },
    { "type": "rename", "id": "id__old", "newTitle": "better title" },
    { "type": "archive", "id": "id__old", "reason": "superseded by id__new" },
    { "type": "update-tags", "id": "id__x", "tags": ["topic__y", "area__z"] }
  ],
  "topOfMind": ["id__abc123", "id__ghi789"]
}

If no changes needed, respond with:
{ "actions": [], "topOfMind": [...] }`;
}

export function parseDefragOutput(raw: string): DefragDecision {
  let cleaned = raw.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`defrag output is not valid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("defrag output must be an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.actions)) {
    throw new Error("defrag output missing 'actions' array");
  }

  if (!Array.isArray(obj.topOfMind)) {
    throw new Error("defrag output missing 'topOfMind' array");
  }

  const actions: DefragAction[] = [];
  for (let i = 0; i < obj.actions.length; i++) {
    const action = obj.actions[i];
    if (typeof action !== "object" || action === null) {
      throw new Error(`action ${i} must be an object`);
    }

    const a = action as Record<string, unknown>;
    if (typeof a.type !== "string") {
      throw new Error(`action ${i} missing type`);
    }

    switch (a.type) {
      case "merge":
        if (!Array.isArray(a.sources) || typeof a.title !== "string" || typeof a.body !== "string") {
          throw new Error(`merge action ${i} missing required fields`);
        }
        actions.push({
          type: "merge",
          sources: a.sources.filter((s): s is string => typeof s === "string"),
          title: a.title,
          body: a.body,
          tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === "string") : [],
        });
        break;

      case "split":
        if (typeof a.source !== "string" || !Array.isArray(a.entries)) {
          throw new Error(`split action ${i} missing required fields`);
        }
        actions.push({
          type: "split",
          source: a.source,
          entries: a.entries
            .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
            .map((e) => ({
              title: String(e.title ?? ""),
              body: String(e.body ?? ""),
              tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [],
            })),
        });
        break;

      case "rename":
        if (typeof a.id !== "string" || typeof a.newTitle !== "string") {
          throw new Error(`rename action ${i} missing required fields`);
        }
        actions.push({ type: "rename", id: a.id, newTitle: a.newTitle });
        break;

      case "archive":
        if (typeof a.id !== "string" || typeof a.reason !== "string") {
          throw new Error(`archive action ${i} missing required fields`);
        }
        actions.push({ type: "archive", id: a.id, reason: a.reason });
        break;

      case "update-tags":
        if (typeof a.id !== "string" || !Array.isArray(a.tags)) {
          throw new Error(`update-tags action ${i} missing required fields`);
        }
        actions.push({
          type: "update-tags",
          id: a.id,
          tags: a.tags.filter((t): t is string => typeof t === "string"),
        });
        break;

      default:
        throw new Error(`unknown action type: ${a.type}`);
    }
  }

  return {
    actions,
    topOfMind: obj.topOfMind.filter((id): id is string => typeof id === "string"),
  };
}
