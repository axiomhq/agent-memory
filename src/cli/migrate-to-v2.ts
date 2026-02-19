/**
 * migration script: old format (metadata header) → pure markdown.
 *
 * old format:
 *   <!-- agent-memory:meta
 *   { "id": "id__XXXXXX", "title": "...", "tags": [...], "used": 3, ... }
 *   -->
 *
 *   body content
 *
 * new format:
 *   # Title
 *
 *   #tag1 #tag2
 *
 *   body content
 *
 * also handles legacy header variant: <!-- axi-agent:memory-meta
 * also strips _top-of-mind prefix from filenames.
 */

import { parseArgs } from "util";
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, statSync } from "fs";
import { join, basename, dirname } from "path";
import { loadConfig, expandPath } from "../config.js";
import { serializeMemoryMarkdown } from "../format.js";

const HEADER_PATTERNS = [
  "<!-- agent-memory:meta",
  "<!-- axi-agent:memory-meta",
];

interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: Array<{ file: string; error: string }>;
}

interface OldMeta {
  id?: string;
  title?: string;
  tags?: string[];
  [key: string]: unknown;
}

function parseOldFormat(text: string): { meta: OldMeta; body: string } | null {
  let headerStart = "";
  let startIdx = -1;

  for (const pattern of HEADER_PATTERNS) {
    startIdx = text.indexOf(pattern);
    if (startIdx !== -1) {
      headerStart = pattern;
      break;
    }
  }

  if (startIdx === -1) return null;

  const jsonStart = startIdx + headerStart.length;
  const endIdx = text.indexOf("-->", jsonStart);
  if (endIdx === -1) return null;

  const jsonStr = text.slice(jsonStart, endIdx).trim().replaceAll("--\\u003E", "-->");

  try {
    const meta = JSON.parse(jsonStr) as OldMeta;
    const body = text.slice(endIdx + 3).trim();
    return { meta, body };
  } catch {
    return null;
  }
}

function isAlreadyMigrated(text: string): boolean {
  // new format starts with # heading, no metadata comment
  return text.trimStart().startsWith("# ") && !HEADER_PATTERNS.some((p) => text.includes(p));
}

function migrateFile(filePath: string, dryRun: boolean): "migrated" | "skipped" | { error: string } {
  const text = readFileSync(filePath, "utf-8");

  if (isAlreadyMigrated(text)) return "skipped";

  const parsed = parseOldFormat(text);
  if (!parsed) return "skipped";

  const { meta, body } = parsed;
  const title = meta.title ?? basename(filePath, ".md");
  const tags: string[] = (meta.tags ?? []).filter((t): t is string => typeof t === "string");

  const newContent = serializeMemoryMarkdown(title, tags, body);

  if (!dryRun) {
    writeFileSync(filePath, newContent, "utf-8");
  }

  // handle _top-of-mind prefix in filename
  const filename = basename(filePath);
  if (filename.startsWith("_top-of-mind")) {
    const newFilename = filename.replace(/^_top-of-mind[-_ ]*/, "");
    if (newFilename !== filename && newFilename.length > 0) {
      const newPath = join(dirname(filePath), newFilename);
      if (!dryRun) {
        renameSync(filePath, newPath);
      }
      return "migrated";
    }
  }

  // handle old filename format with -- tag section
  if (filename.includes(" -- ")) {
    const idMatch = filename.match(/(id__[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6})\.md$/);
    if (idMatch) {
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);
      const newFilename = `${slug} ${idMatch[1]}.md`;
      const newPath = join(dirname(filePath), newFilename);
      if (newPath !== filePath && !dryRun) {
        renameSync(filePath, newPath);
      }
    }
  }

  return "migrated";
}

function walkMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMdFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function run(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      "root-dir": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });

  const config = loadConfig();
  const rootDir = values["root-dir"] ?? expandPath(config.storage.root);
  const dryRun = values["dry-run"] ?? false;

  if (!existsSync(rootDir)) {
    console.error(`error: root directory does not exist: ${rootDir}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log("DRY RUN — no files will be modified\n");
  }

  const files = walkMdFiles(rootDir);
  console.log(`found ${files.length} .md files in ${rootDir}\n`);

  const result: MigrationResult = { migrated: 0, skipped: 0, errors: [] };

  for (const file of files) {
    const relPath = file.replace(rootDir + "/", "");
    const outcome = migrateFile(file, dryRun);

    if (outcome === "migrated") {
      result.migrated++;
      console.log(`  ✓ ${relPath}`);
    } else if (outcome === "skipped") {
      result.skipped++;
    } else {
      result.errors.push({ file: relPath, error: outcome.error });
      console.error(`  ✗ ${relPath}: ${outcome.error}`);
    }
  }

  console.log(`\nsummary: ${result.migrated} migrated, ${result.skipped} skipped, ${result.errors.length} errors`);
}

// direct execution
if (import.meta.main) {
  run(process.argv.slice(2));
}
