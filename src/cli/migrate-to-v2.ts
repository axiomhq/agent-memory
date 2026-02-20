/**
 * migration script: old format (metadata header) → pure markdown,
 * old directories → orgs/{org}/archive/.
 *
 * format migration:
 *   old: <!-- agent-memory:meta { ... } --> body
 *   new: # Title\n\n#tag1 #tag2\n\nbody
 *
 * directory relocation:
 *   {root}/topics/*                → {root}/orgs/{org}/archive/
 *   {root}/orgs/{org}/topics/*     → {root}/orgs/{org}/archive/
 *
 * also handles legacy header variant: <!-- axi-agent:memory-meta
 * also strips _top-of-mind prefix and -- tag sections from filenames.
 * deduplicates when an entry ID already exists in the target archive.
 */

import { parseArgs } from "util";
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, statSync, mkdirSync, unlinkSync, rmSync } from "fs";
import { join, basename, dirname, relative } from "path";
import { loadConfig, expandPath } from "../config.js";
import { serializeMemoryMarkdown } from "../format.js";

const HEADER_PATTERNS = [
  "<!-- agent-memory:meta",
  "<!-- axi-agent:memory-meta",
];

interface MigrationResult {
  migrated: number;
  skipped: number;
  relocated: number;
  deduplicated: number;
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

const ID_PATTERN = /(id__[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6})\.md$/;

/**
 * determines if a file is in a directory that should be relocated to archive.
 * returns { org, archiveDir } if relocation needed, null otherwise.
 *
 * patterns:
 *   {root}/topics/*            → orgs/{defaultOrg}/archive/
 *   {root}/orgs/{org}/topics/* → orgs/{org}/archive/
 */
function getRelocationTarget(
  filePath: string,
  rootDir: string,
  defaultOrg: string,
): { org: string; archiveDir: string } | null {
  const rel = relative(rootDir, filePath);
  const parts = rel.split("/");

  // {root}/topics/file.md
  if (parts[0] === "topics" && parts.length === 2) {
    return {
      org: defaultOrg,
      archiveDir: join(rootDir, "orgs", defaultOrg, "archive"),
    };
  }

  // {root}/orgs/{org}/topics/file.md
  if (parts[0] === "orgs" && parts[2] === "topics" && parts.length === 4) {
    const org = parts[1]!;
    return {
      org,
      archiveDir: join(rootDir, "orgs", org, "archive"),
    };
  }

  return null;
}

/**
 * checks if an entry already exists in the target archive directory.
 * matches by ID first, then by title slug (catches re-seeded entries
 * with different IDs but identical content, e.g. repo profiles).
 */
function entryExistsInArchive(id: string, filename: string, archiveDir: string): boolean {
  if (!existsSync(archiveDir)) return false;
  const archiveFiles = readdirSync(archiveDir);

  // exact ID match
  if (archiveFiles.some((f) => f.includes(id))) return true;

  // title-slug match: strip the id suffix to get the slug, check if
  // any archive file starts with the same slug
  const slug = filename.replace(ID_PATTERN, "").trim();
  if (slug) {
    return archiveFiles.some((f) => f.replace(ID_PATTERN, "").trim() === slug);
  }

  return false;
}

/**
 * relocates a file from topics/ to orgs/{org}/archive/.
 * returns "relocated" | "deduplicated" | null (no relocation needed).
 */
function relocateFile(
  filePath: string,
  rootDir: string,
  defaultOrg: string,
  dryRun: boolean,
): "relocated" | "deduplicated" | null {
  const target = getRelocationTarget(filePath, rootDir, defaultOrg);
  if (!target) return null;

  const filename = basename(filePath);
  const idMatch = filename.match(ID_PATTERN);
  if (!idMatch) return null;

  const id = idMatch[1]!;

  // if an entry with this ID or title already exists in archive, delete the duplicate
  if (entryExistsInArchive(id, filename, target.archiveDir)) {
    if (!dryRun) {
      unlinkSync(filePath);
    }
    return "deduplicated";
  }

  if (!dryRun) {
    if (!existsSync(target.archiveDir)) {
      mkdirSync(target.archiveDir, { recursive: true });
    }
    const destPath = join(target.archiveDir, filename);
    renameSync(filePath, destPath);
  }

  return "relocated";
}

/**
 * removes empty directories left behind after relocation.
 */
function cleanupEmptyDirs(rootDir: string): void {
  const topicsDir = join(rootDir, "topics");
  if (existsSync(topicsDir) && readdirSync(topicsDir).length === 0) {
    rmSync(topicsDir, { recursive: true });
  }

  const orgsDir = join(rootDir, "orgs");
  if (!existsSync(orgsDir)) return;
  for (const orgEntry of readdirSync(orgsDir, { withFileTypes: true })) {
    if (!orgEntry.isDirectory()) continue;
    const orgTopics = join(orgsDir, orgEntry.name, "topics");
    if (existsSync(orgTopics) && readdirSync(orgTopics).length === 0) {
      rmSync(orgTopics, { recursive: true });
    }
  }
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
      "org": { type: "string", default: "default" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });

  const config = loadConfig();
  const rootDir = values["root-dir"] ?? expandPath(config.storage.root);
  const defaultOrg = values["org"] ?? "default";
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

  const result: MigrationResult = { migrated: 0, skipped: 0, relocated: 0, deduplicated: 0, errors: [] };

  // pass 1: format migration (convert old metadata header → pure markdown, fix filenames)
  console.log("pass 1: format migration");
  for (const file of files) {
    const relPath = file.replace(rootDir + "/", "");
    const outcome = migrateFile(file, dryRun);

    if (outcome === "migrated") {
      result.migrated++;
      console.log(`  ✓ migrated ${relPath}`);
    } else if (outcome === "skipped") {
      result.skipped++;
    } else {
      result.errors.push({ file: relPath, error: outcome.error });
      console.error(`  ✗ ${relPath}: ${outcome.error}`);
    }
  }

  // pass 2: directory relocation (topics/ → orgs/{org}/archive/)
  // re-walk because filenames may have changed in pass 1
  const filesAfterMigrate = walkMdFiles(rootDir);
  console.log("\npass 2: directory relocation");
  for (const file of filesAfterMigrate) {
    const relPath = file.replace(rootDir + "/", "");
    const outcome = relocateFile(file, rootDir, defaultOrg, dryRun);

    if (outcome === "relocated") {
      result.relocated++;
      console.log(`  → relocated ${relPath}`);
    } else if (outcome === "deduplicated") {
      result.deduplicated++;
      console.log(`  ⊘ deduplicated ${relPath} (already in archive)`);
    }
  }

  // pass 3: cleanup empty directories
  if (!dryRun) {
    cleanupEmptyDirs(rootDir);
  }

  console.log(
    `\nsummary: ${result.migrated} migrated, ${result.relocated} relocated, ${result.deduplicated} deduplicated, ${result.skipped} skipped, ${result.errors.length} errors`,
  );
}

// direct execution
if (import.meta.main) {
  run(process.argv.slice(2));
}
