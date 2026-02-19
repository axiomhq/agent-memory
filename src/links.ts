/**
 * wiki-style link parsing for [[id__XXXXXX|display text]] syntax.
 *
 * two forms:
 *   - [[id__XXXXXX|display text]] — full form with alias
 *   - [[id__XXXXXX]]             — short form (displayText = id)
 *
 * WHY wiki links: they create an explicit, parseable graph between entries.
 * the id stays stable across renames; display text is cosmetic.
 */

/** base58 charset used in IDs — no 0, O, I, l */
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** matches [[id__XXXXXX|optional display text]] outside code blocks */
const LINK_PATTERN = new RegExp(
  `\\[\\[(id__[${BASE58}]{6})(?:\\|([^\\]]*?))?\\]\\]`,
  "g",
);

export interface LinkRef {
  id: string;
  displayText: string;
  position: { start: number; end: number };
}

/**
 * extract all wiki links from a markdown body.
 * skips links inside fenced code blocks.
 */
export function extractLinks(body: string): LinkRef[] {
  const links: LinkRef[] = [];
  const lines = body.split("\n");
  let inCodeBlock = false;
  let offset = 0;

  for (const line of lines) {
    if (/^```/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock;
      offset += line.length + 1; // +1 for \n
      continue;
    }

    if (inCodeBlock) {
      offset += line.length + 1;
      continue;
    }

    const pattern = new RegExp(LINK_PATTERN.source, "g");
    for (const match of line.matchAll(pattern)) {
      const id = match[1]!;
      const displayText = match[2] ?? id;
      const start = offset + match.index!;
      const end = start + match[0].length;

      links.push({ id, displayText, position: { start, end } });
    }

    offset += line.length + 1;
  }

  return links;
}

/**
 * replace all links targeting oldId with newId, preserving display text.
 */
export function replaceLink(body: string, oldId: string, newId: string): string {
  const pattern = new RegExp(
    `\\[\\[${escapeRegex(oldId)}(\\|[^\\]]*?)?\\]\\]`,
    "g",
  );
  return body.replace(pattern, (_match, alias?: string) => {
    return `[[${newId}${alias ?? ""}]]`;
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
