/**
 * tag extraction from inline #tag syntax in markdown bodies.
 *
 * rules:
 *   - a tag is # followed by word characters (a-z0-9_), optionally namespaced (area__work)
 *   - NOT preceded by a word character (avoids matching inside URLs/identifiers)
 *   - headings (lines starting with # followed by space) are not tags
 *   - content inside fenced code blocks (```) is skipped
 *   - hex colors (#ff0000) are not tags (all-hex after # is rejected)
 *
 * WHY separate file: tags are a cross-cutting extraction utility used by
 * persistence, defrag, and format. keeping it isolated makes testing and
 * reuse straightforward.
 */

/** hex color: exactly 6 or 8 hex digits (CSS rgb/rgba) */
const HEX_COLOR_PATTERN = /^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/**
 * extract tags from a markdown body. returns tag names without the # prefix.
 * skips headings, fenced code blocks, and hex colors.
 */
export function extractTags(body: string): string[] {
  const tags: string[] = [];
  const lines = body.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    // toggle fenced code blocks
    if (/^```/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    // skip headings: line starts with one or more # followed by space
    if (/^#+\s/.test(line)) continue;

    // create fresh regex per line to avoid global lastIndex state leaking
    const tagPattern = /(?<!\w)#([a-zA-Z_][a-zA-Z0-9_]*(?:__[a-zA-Z0-9_]+)*)\b/g;
    for (const match of line.matchAll(tagPattern)) {
      const tag = match[1]!;

      // skip hex colors
      if (HEX_COLOR_PATTERN.test(tag)) continue;

      if (!tags.includes(tag)) {
        tags.push(tag);
      }
    }
  }

  return tags;
}
