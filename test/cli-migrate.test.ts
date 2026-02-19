import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * import the migration internals indirectly — we test via the file format.
 * the migration script reads old-format files and writes new-format files.
 */

// inline the migration logic for testing since run() calls process.exit
import { serializeMemoryMarkdown, parseMemoryMarkdown } from "../src/format.js";

const HEADER_PATTERNS = ["<!-- agent-memory:meta", "<!-- axi-agent:memory-meta"];

function parseOldFormat(text: string): { meta: Record<string, unknown>; body: string } | null {
  let headerStart = "";
  let startIdx = -1;
  for (const pattern of HEADER_PATTERNS) {
    startIdx = text.indexOf(pattern);
    if (startIdx !== -1) { headerStart = pattern; break; }
  }
  if (startIdx === -1) return null;
  const jsonStart = startIdx + headerStart.length;
  const endIdx = text.indexOf("-->", jsonStart);
  if (endIdx === -1) return null;
  const jsonStr = text.slice(jsonStart, endIdx).trim().replaceAll("--\\u003E", "-->");
  try {
    const meta = JSON.parse(jsonStr) as Record<string, unknown>;
    const body = text.slice(endIdx + 3).trim();
    return { meta, body };
  } catch { return null; }
}

function migrateContent(text: string, fallbackTitle: string): string | null {
  const parsed = parseOldFormat(text);
  if (!parsed) return null;
  const title = (parsed.meta.title as string) ?? fallbackTitle;
  const tags = ((parsed.meta.tags as string[]) ?? []).filter((t): t is string => typeof t === "string");
  return serializeMemoryMarkdown(title, tags, parsed.body);
}

describe("migrate-to-v2", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `migrate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, "topics"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("converts old agent-memory:meta format to pure markdown", () => {
    const oldContent = `<!-- agent-memory:meta
{
  "id": "id__abc123",
  "title": "Test Entry",
  "tags": ["topic__testing", "area__work"],
  "status": "consolidated",
  "used": 5,
  "last_used": "2024-01-01T00:00:00.000Z",
  "pinned": true,
  "createdAt": 1700000000000,
  "updatedAt": 1700000001000
}
-->

This is the body content.

With multiple paragraphs.`;

    const result = migrateContent(oldContent, "fallback");
    expect(result).not.toBeNull();
    expect(result).toContain("# Test Entry");
    expect(result).toContain("#topic__testing #area__work");
    expect(result).toContain("This is the body content.");
    expect(result).toContain("With multiple paragraphs.");
    // should NOT contain old metadata fields
    expect(result).not.toContain("used");
    expect(result).not.toContain("pinned");
    expect(result).not.toContain("last_used");
    expect(result).not.toContain("status");
    expect(result).not.toContain("<!-- agent-memory:meta");
  });

  test("handles legacy axi-agent:memory-meta header", () => {
    const oldContent = `<!-- axi-agent:memory-meta
{
  "id": "id__abc123",
  "title": "Legacy Entry",
  "tags": [],
  "status": "captured",
  "used": 0,
  "last_used": "2024-01-01T00:00:00.000Z",
  "pinned": false,
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
-->

Legacy body.`;

    const result = migrateContent(oldContent, "fallback");
    expect(result).not.toBeNull();
    expect(result).toContain("# Legacy Entry");
    expect(result).toContain("Legacy body.");
    expect(result).not.toContain("axi-agent:memory-meta");
  });

  test("skips already-migrated files (pure markdown)", () => {
    const newContent = "# Already Migrated\n\n#tag1\n\nBody here.";
    const result = migrateContent(newContent, "fallback");
    expect(result).toBeNull(); // no old format found
  });

  test("tags converted from array to inline", () => {
    const oldContent = `<!-- agent-memory:meta
{
  "id": "id__abc123",
  "title": "Tagged",
  "tags": ["topic__xstate", "area__testing", "scope__project"],
  "status": "consolidated",
  "used": 1,
  "last_used": "2024-01-01",
  "pinned": false,
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
-->

Content.`;

    const result = migrateContent(oldContent, "fallback");
    expect(result).toContain("#topic__xstate #area__testing #scope__project");
  });

  test("handles entry with no tags", () => {
    const oldContent = `<!-- agent-memory:meta
{
  "id": "id__abc123",
  "title": "No Tags",
  "status": "captured",
  "used": 0,
  "last_used": "2024-01-01",
  "pinned": false,
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
-->

No tags content.`;

    const result = migrateContent(oldContent, "fallback");
    expect(result).not.toBeNull();
    expect(result).toContain("# No Tags");
    expect(result).toContain("No tags content.");
    // no tag line
    const lines = result!.split("\n");
    expect(lines[0]).toBe("# No Tags");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("No tags content.");
  });

  test("preserves existing [[links]] in body", () => {
    const oldContent = `<!-- agent-memory:meta
{
  "id": "id__abc123",
  "title": "Linked",
  "tags": [],
  "status": "consolidated",
  "used": 1,
  "last_used": "2024-01-01",
  "pinned": false,
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
-->

References [[id__zzzzzz|other note]] inline.`;

    const result = migrateContent(oldContent, "fallback");
    expect(result).toContain("[[id__zzzzzz|other note]]");
  });

  test("is idempotent — migrating already-migrated returns same format", () => {
    const oldContent = `<!-- agent-memory:meta
{
  "id": "id__abc123",
  "title": "Test",
  "tags": ["tag1"],
  "status": "captured",
  "used": 0,
  "last_used": "2024-01-01",
  "pinned": false,
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
-->

Body.`;

    const migrated = migrateContent(oldContent, "fallback");
    expect(migrated).not.toBeNull();

    // trying to migrate the output should return null (no old format found)
    const secondPass = migrateContent(migrated!, "fallback");
    expect(secondPass).toBeNull();
  });

  test("migrated content roundtrips through parseMemoryMarkdown", () => {
    const oldContent = `<!-- agent-memory:meta
{
  "id": "id__abc123",
  "title": "Roundtrip Test",
  "tags": ["topic__test"],
  "status": "consolidated",
  "used": 3,
  "last_used": "2024-06-01",
  "pinned": true,
  "createdAt": 1700000000000,
  "updatedAt": 1700000001000
}
-->

Important body content here.`;

    const migrated = migrateContent(oldContent, "fallback")!;
    const parsed = parseMemoryMarkdown(migrated, "test.md", "id__abc123");
    expect(parsed.isOk()).toBe(true);
    if (parsed.isOk()) {
      expect(parsed.value.title).toBe("Roundtrip Test");
      expect(parsed.value.body).toContain("topic__test");
      expect(parsed.value.body).toContain("Important body content here.");
    }
  });

  test("uses fallback title when meta has no title", () => {
    const oldContent = `<!-- agent-memory:meta
{
  "id": "id__abc123",
  "status": "captured",
  "used": 0,
  "last_used": "2024-01-01",
  "pinned": false,
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
-->

Body without title.`;

    const result = migrateContent(oldContent, "my-fallback");
    expect(result).toContain("# my-fallback");
  });
});
