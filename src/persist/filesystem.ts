/**
 * file-based memory persistence adapter.
 *
 * directory layout:
 *   orgs/{org}/archive/   — all processed entries (flat)
 *   orgs/{org}/inbox/     — journal queue (ephemeral)
 *
 * filename convention:
 *   regular:      descriptive-title -- kw1 kw2 id__XXXXXX.md
 *   top-of-mind:  _top-of-mind id__XXXXXX -- kw1 kw2 kw3.md
 *
 * top-of-mind is a filesystem-level signal, not metadata.
 * the `_top-of-mind` prefix determines hot-tier inclusion in AGENTS.md.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, renameSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { ResultAsync, errAsync } from "neverthrow";
import { type } from "arktype";
import { isValidId } from "../id.js";
import { serializeMemoryMarkdown, parseMemoryMarkdown } from "../format.js";
import { MemoryEntryMetaSchema, type MemoryEntry, type MemoryEntryMeta } from "../schema.js";
import type { MemoryPersistenceAdapter, MemoryPersistenceError, MemoryListFilter } from "./index.js";

const TOP_OF_MIND_PREFIX = "_top-of-mind";
const DEFAULT_ORG = "default";
const ORGS_DIR = "orgs";
const ARCHIVE_DIR = "archive";

function sanitizeFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function buildFilename(meta: MemoryEntryMeta, topOfMind: boolean): string {
  const titlePart = sanitizeFilename(meta.title);
  const tagsPart = (meta.tags ?? [])
    .filter((t) => t.startsWith("topic__"))
    .map((t) => t.replace("topic__", "").replace(/[^a-z0-9]/g, ""))
    .slice(0, 3)
    .join(" ");
  const idPart = meta.id;

  if (topOfMind) {
    const kw = tagsPart ? ` -- ${tagsPart}` : "";
    return `${TOP_OF_MIND_PREFIX} ${idPart}${kw}.md`;
  }

  if (tagsPart) {
    return `${titlePart} -- ${tagsPart} ${idPart}.md`;
  }
  return `${titlePart} ${idPart}.md`;
}

function extractIdFromFilename(filename: string): string | null {
  const match = filename.match(/(id__[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6})(?:\.md$| )/);
  return match?.[1] ?? null;
}

export function isTopOfMindFilename(filename: string): boolean {
  return filename.startsWith(TOP_OF_MIND_PREFIX);
}

interface FileAdapterOptions {
  rootDir: string;
}

function readEntriesFromDir(dir: string): Array<{ meta: MemoryEntryMeta; filePath: string; topOfMind: boolean }> {
  if (!existsSync(dir)) return [];

  const results: Array<{ meta: MemoryEntryMeta; filePath: string; topOfMind: boolean }> = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;

    const id = extractIdFromFilename(file);
    if (!id) continue;

    const filePath = join(dir, file);
    try {
      const text = readFileSync(filePath, "utf-8");
      const result = parseMemoryMarkdown(text, filePath);
      if (result.isErr()) continue;

      if (result.value.meta.id !== id) continue;

      results.push({
        meta: result.value.meta,
        filePath,
        topOfMind: isTopOfMindFilename(file),
      });
    } catch {
      continue;
    }
  }

  return results;
}

export function createFileMemoryPersistenceAdapter(options: FileAdapterOptions): MemoryPersistenceAdapter {
  const rootDir = options.rootDir;

  function getArchiveDir(org: string): string {
    return join(rootDir, ORGS_DIR, org, ARCHIVE_DIR);
  }

  function getOrgNames(): string[] {
    const orgsDir = join(rootDir, ORGS_DIR);
    if (!existsSync(orgsDir)) return [];

    const orgs: string[] = [];
    for (const entry of readdirSync(orgsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        orgs.push(entry.name);
      }
    }
    return orgs;
  }

  function findEntryFile(id: string): string | null {
    for (const org of getOrgNames()) {
      const dir = getArchiveDir(org);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (file.includes(id)) {
          return join(dir, file);
        }
      }
    }
    return null;
  }

  return {
    list(filter?: MemoryListFilter): ResultAsync<MemoryEntryMeta[], MemoryPersistenceError> {
      return ResultAsync.fromPromise(
        (async () => {
          let entries: MemoryEntryMeta[] = [];
          const org = filter?.org ?? DEFAULT_ORG;

          const dir = getArchiveDir(org);
          entries.push(...readEntriesFromDir(dir).map((e) => e.meta));

          if (filter?.status) {
            entries = entries.filter((e) => e.status === filter.status);
          }

          if (filter?.tags && filter.tags.length > 0) {
            entries = entries.filter((e) =>
              filter.tags!.every((tag) => e.tags?.includes(tag))
            );
          }

          if (filter?.query) {
            const q = filter.query.toLowerCase();
            entries = entries.filter(
              (e: MemoryEntryMeta) =>
                e.title.toLowerCase().includes(q) ||
                e.tags?.some((t: string) => t.toLowerCase().includes(q)),
            );
          }

          entries.sort((a, b) => b.updatedAt - a.updatedAt);

          if (filter?.limit && filter.limit > 0) {
            entries = entries.slice(0, filter.limit);
          }

          return entries;
        })(),
        (e: unknown): MemoryPersistenceError => ({
          _tag: "memory.persist.read",
          path: rootDir,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    },

    read(id: string): ResultAsync<MemoryEntry, MemoryPersistenceError> {
      if (!isValidId(id)) {
        return errAsync({
          _tag: "memory.persist.read",
          path: id,
          message: `invalid memory ID format: ${id}`,
        });
      }

      return ResultAsync.fromPromise(
        (async () => {
          const filePath = findEntryFile(id);
          if (!filePath) {
            throw new Error(`memory entry not found: ${id}`);
          }

          const text = readFileSync(filePath, "utf-8");
          const result = parseMemoryMarkdown(text, filePath);
          if (result.isErr()) {
            throw new Error(result.error.message);
          }

          return result.value;
        })(),
        (e: unknown): MemoryPersistenceError => ({
          _tag: "memory.persist.read",
          path: id,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    },

    write(entry: MemoryEntry): ResultAsync<void, MemoryPersistenceError> {
      const { meta, body } = entry;

      if (!isValidId(meta.id)) {
        return errAsync({
          _tag: "memory.persist.write",
          path: meta.id,
          message: `invalid memory ID format: ${meta.id}`,
        });
      }

      const validated = MemoryEntryMetaSchema(meta);
      if (validated instanceof type.errors) {
        return errAsync({
          _tag: "memory.persist.write",
          path: meta.id,
          message: `schema validation failed: ${validated.summary}`,
        });
      }

      return ResultAsync.fromPromise(
        (async () => {
          const org = meta.org;
          const targetDir = getArchiveDir(org);
          if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
          }

          const existingFile = findEntryFile(meta.id);
          const wasTopOfMind = existingFile ? isTopOfMindFilename(basename(existingFile)) : false;

          if (existingFile) {
            rmSync(existingFile, { force: true });
          }

          const filename = buildFilename(meta, wasTopOfMind);
          const filePath = join(targetDir, filename);
          const content = serializeMemoryMarkdown(meta, body);

          const tempPath = join(
            targetDir,
            `.${meta.id}.md.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`,
          );

          try {
            writeFileSync(tempPath, content, "utf-8");
            renameSync(tempPath, filePath);
          } catch (e) {
            try {
              unlinkSync(tempPath);
            } catch {
              /* best-effort */
            }
            throw e;
          }
        })(),
        (e: unknown): MemoryPersistenceError => ({
          _tag: "memory.persist.write",
          path: meta.id,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    },

    delete(id: string): ResultAsync<void, MemoryPersistenceError> {
      if (!isValidId(id)) {
        return errAsync({
          _tag: "memory.persist.delete",
          path: id,
          message: `invalid memory ID format: ${id}`,
        });
      }

      return ResultAsync.fromPromise(
        (async () => {
          const filePath = findEntryFile(id);
          if (filePath) {
            rmSync(filePath, { force: true });
          }
        })(),
        (e: unknown): MemoryPersistenceError => ({
          _tag: "memory.persist.delete",
          path: id,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    },
  };
}

/**
 * renames a file to add or remove the _top-of-mind prefix.
 * used by defrag to mark entries as top-of-mind based on LLM decision.
 * returns the new file path, or null if the entry wasn't found.
 */
export function setTopOfMind(rootDir: string, id: string, topOfMind: boolean): string | null {
  const adapter = createFileMemoryPersistenceAdapter({ rootDir });

  for (const org of getOrgNamesFromRoot(rootDir)) {
    const dir = join(rootDir, ORGS_DIR, org, ARCHIVE_DIR);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.includes(id)) continue;

      const currentlyTopOfMind = isTopOfMindFilename(file);
      if (currentlyTopOfMind === topOfMind) {
        return join(dir, file);
      }

      const filePath = join(dir, file);
      const text = readFileSync(filePath, "utf-8");
      const result = parseMemoryMarkdown(text, filePath);
      if (result.isErr()) continue;

      const meta = result.value.meta;
      const newFilename = buildFilename(meta, topOfMind);
      const newPath = join(dir, newFilename);

      renameSync(filePath, newPath);
      return newPath;
    }
  }

  return null;
}

function getOrgNamesFromRoot(rootDir: string): string[] {
  const orgsDir = join(rootDir, ORGS_DIR);
  if (!existsSync(orgsDir)) return [];

  const orgs: string[] = [];
  for (const entry of readdirSync(orgsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      orgs.push(entry.name);
    }
  }
  return orgs;
}
