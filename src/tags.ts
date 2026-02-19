/**
 * tag extraction from inline #tag syntax in markdown bodies.
 *
 * rules:
 *   - a tag is # followed by a letter or underscore, then word chars, optionally namespaced (area__work)
 *   - NOT preceded by a word character (avoids matching inside URLs/identifiers)
 *   - heading markers (# ## ###) are stripped before scanning, but tags on heading lines ARE extracted
 *   - content inside fenced code blocks (```) is skipped
 *
 * WHY separate file: tags are a cross-cutting extraction utility used by
 * persistence, defrag, and format. keeping it isolated makes testing and
 * reuse straightforward.
 */

/**
 * extract tags from a markdown body. returns tag names without the # prefix.
 * strips heading markers before scanning so tags on heading lines are found.
 * skips fenced code blocks.
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

    // strip heading markers so "# Title #important" scans as "Title #important"
    const scanLine = line.replace(/^#+\s+/, "");

    // fresh regex per line to avoid global lastIndex state leaking
    const tagPattern = /(?<!\w)#([a-zA-Z_][a-zA-Z0-9_]*(?:__[a-zA-Z0-9_]+)*)\b/g;
    for (const match of scanLine.matchAll(tagPattern)) {
      const tag = match[1]!;
      if (!tags.includes(tag)) {
        tags.push(tag);
      }
    }
  }

  return tags;
}
