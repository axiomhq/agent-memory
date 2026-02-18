/**
 * prompt builder for journal → knowledge-base consolidation.
 * pure function: given journals + existing entries, produces a prompt string.
 */

export interface JournalForPrompt {
  id: string;
  title: string;
  body: string;
  tags: string[];
}

export interface ExistingEntryRef {
  id: string;
  title: string;
  tags: string[];
}

export function buildConsolidationPrompt(
  journals: JournalForPrompt[],
  existingEntries: ExistingEntryRef[],
  historyContent?: string,
): string {
  const existingSection =
    existingEntries.length > 0
      ? existingEntries.map((e) => `- ${e.id}: "${e.title}" (${e.tags.join(", ")})`).join("\n")
      : "(none yet)";

  const journalSection = journals
    .map((j) => {
      const tags = j.tags.length > 0 ? ` (tags: ${j.tags.join(", ")})` : "";
      return `### ${j.id}: "${j.title}"${tags}\n\n${j.body}`;
    })
    .join("\n\n---\n\n");

  const historySection =
    historyContent && historyContent.trim().length > 0
      ? `## Thread history (full conversation content)\n\n${historyContent}`
      : "";

  return `You are consolidating raw journal entries into a curated knowledge base.

The knowledge base follows the zettelkasten method:
- Each entry explains a SINGLE idea, fact, pattern, or gotcha
- Entries cross-reference each other using [[id__XXXXXX]] syntax
- Entries use #tags for retrieval (format: topic__name, area__name)
- Entries are concise — one concept per note, not a summary of everything

## Existing knowledge-base entries (for cross-referencing)

${existingSection}

## Journal entries to consolidate

${journalSection}
${historySection ? `\n${historySection}` : ""}

## Instructions

Decompose the journal entries above into atomic knowledge-base notes. Each note should:

1. Cover a SINGLE concept, pattern, gotcha, or fact
2. Include relevant #tags inline in the body for retrieval (e.g., topic__xstate, area__testing)
3. Cross-reference related entries using [[id__XXXXXX]] syntax:
   - To existing entries: [[id__XXXXXX]]
   - To other new entries you're creating: [[pending:their-title]]
4. Be self-contained — readable without the source journal
5. Omit session-specific context (timestamps, "I was debugging...")

If a journal entry contains multiple distinct learnings, split them into separate notes.
If two journal entries describe the same concept, merge into one note.
If a journal entry contains no durable knowledge (e.g., "started working on X"), skip it.

Respond with ONLY a JSON array. No markdown fencing, no explanation:

[
  {
    "title": "concise descriptive title",
    "body": "the atomic note content with #tags and [[id__XXXXXX]] links",
    "tags": ["topic__foo", "area__bar"]
  }
]

If there is nothing worth extracting, respond with an empty array: []`;
}

export interface ParsedKbEntry {
  title: string;
  body: string;
  tags: string[];
}

export function parseConsolidationOutput(raw: string): ParsedKbEntry[] {
  let cleaned = raw.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`agent output is not valid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`agent output is not an array: ${typeof parsed}`);
  }

  const entries: ParsedKbEntry[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.title !== "string" ||
      typeof item.body !== "string"
    ) {
      throw new Error(`entry ${i} missing required fields (title, body)`);
    }

    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t: unknown) => typeof t === "string")
      : [];

    entries.push({
      title: item.title,
      body: item.body,
      tags,
    });
  }

  return entries;
}

export function resolveIntraBatchLinks(
  entries: Array<{ title: string; body: string; id: string }>,
): Array<{ id: string; body: string }> {
  const titleToId = new Map(entries.map((e) => [e.title.toLowerCase(), e.id]));

  return entries.map((entry) => {
    const resolved = entry.body.replace(
      /\[\[pending:([^\]]+)\]\]/g,
      (_match, pendingTitle: string) => {
        const id = titleToId.get(pendingTitle.toLowerCase());
        return id ? `[[${id}]]` : `[[pending:${pendingTitle}]]`;
      },
    );
    return { id: entry.id, body: resolved };
  });
}
