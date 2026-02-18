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

CRITICAL: Your entire response must be ONLY a raw JSON array. No prose, no explanation, no markdown fencing. Start your response with [ and end with ]. Any text outside the JSON array will cause a parse failure.

[
  {
    "title": "concise descriptive title",
    "body": "the atomic note content with #tags and [[id__XXXXXX]] links",
    "tags": ["topic__foo", "area__bar"]
  }
]

If there is nothing worth extracting, respond with: []`;
}

export interface ParsedKbEntry {
  title: string;
  body: string;
  tags: string[];
}

/**
 * extracts a JSON array from LLM output that may contain prose preamble,
 * markdown code fences, or other non-JSON wrapping.
 *
 * strategy: try raw parse → strip code fences → find outermost [ ] brackets.
 * the bracket fallback handles the common LLM failure mode of prefixing
 * "Here are the entries:" before the actual JSON.
 */
function extractJsonArray(raw: string): unknown {
  const trimmed = raw.trim();

  // fast path: raw output is already valid JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue to fallbacks
  }

  // strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]!);
    } catch {
      // continue to bracket extraction
    }
  }

  // find JSON array via bracket matching — search from the end to skip
  // wiki-link noise like [[id__XXXXXX]] that confuses greedy first-[ search.
  for (let end = trimmed.length - 1; end >= 0; end--) {
    if (trimmed[end] !== "]") continue;
    let depth = 0;
    for (let start = end; start >= 0; start--) {
      if (trimmed[start] === "]") depth++;
      else if (trimmed[start] === "[") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          break; // this balanced pair isn't valid JSON, try earlier ]
        }
      }
    }
  }

  throw new Error(`agent output is not valid JSON: ${trimmed.slice(0, 200)}`);
}

export function parseConsolidationOutput(raw: string): ParsedKbEntry[] {
  const parsed = extractJsonArray(raw);

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
