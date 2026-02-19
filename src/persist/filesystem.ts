/**
 * file-based memory persistence adapter.
 * directory layout: orgs/{org}/archive/ — all entries scoped under an org.
 * filename convention: slug id__XXXXXX.md
 *
 * WHY no tags in filename, no _top-of-mind prefix:
 * per notes-and-links ADR, entries are pure markdown. tags live inline
 * in body, title from # heading, id from filename.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, renameSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { ResultAsync, errAsync } from "neverthrow";
import { isValidId } from "../id.js";
import { serializeMemoryMarkdown, parseMemoryMarkdown } from "../format.js";
import { extractTags } from "../tags.js";
import type { MemoryEntry, MemoryEntryMeta } from "../schema.js";
import type { MemoryPersistenceAdapter, MemoryPersistenceError, MemoryListFilter } from "./index.js";

function sanitizeFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function buildFilename(meta: MemoryEntryMeta): string {
  const titlePart = sanitizeFilename(meta.title);
  return `${titlePart} ${meta.id}.md`;
}

function extractIdFromFilename(filename: string): string | null {
  const match = filename.match(/(id__[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6})\.md$/);
  return match?.[1] ?? null;
}

interface FileAdapterOptions {
  rootDir: string;
}


function readEntriesFromDir(dir: string, org: string): Array<{ meta: MemoryEntryMeta; filePath: string }> {
  if (!existsSync(dir)) return [];

  const results: Array<{ meta: MemoryEntryMeta; filePath: string }> = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;

    const id = extractIdFromFilename(file);
    if (!id) continue;

    const filePath = join(dir, file);
    try {
      const text = readFileSync(filePath, "utf-8");
      const result = parseMemoryMarkdown(text, filePath, id);
      if (result.isErr()) continue;

      const tags = extractTags(text);

      results.push({
        meta: {
          id,
          title: result.value.title,
          tags,
          org,
        },
        filePath,
      });
    } catch {
      continue;
    }
  }

  return results;
}

const ARCHIVE_DIR = "archive";
const ORGS_DIR = "orgs";

export function createFileMemoryPersistenceAdapter(options: FileAdapterOptions): MemoryPersistenceAdapter {
  const opts: Required<FileAdapterOptions> = {
    rootDir: options.rootDir,
  };

  function getArchiveDir(org: string): string {
    return join(opts.rootDir, ORGS_DIR, org, ARCHIVE_DIR);
  }

  /** derive org name from a file path under orgs/{org}/archive/ */
  function orgFromPath(filePath: string): string {
    const rel = filePath.slice(opts.rootDir.length + 1);
    const parts = rel.split("/");
    // orgs/{org}/archive/filename.md
    return parts[1] ?? "default";
  }

  function getOrgsDirs(): string[] {
    const orgsDir = join(opts.rootDir, ORGS_DIR);
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
    for (const org of getOrgsDirs()) {
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

          if (filter?.org) {
            entries.push(...readEntriesFromDir(getArchiveDir(filter.org), filter.org).map((e) => e.meta));
          } else {
            for (const org of getOrgsDirs()) {
              entries.push(...readEntriesFromDir(getArchiveDir(org), org).map((e) => e.meta));
            }
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

          entries.sort((a, b) => a.title.localeCompare(b.title));

          if (filter?.limit && filter.limit > 0) {
            entries = entries.slice(0, filter.limit);
          }

          return entries;
        })(),
        (e: unknown): MemoryPersistenceError => ({
          _tag: "memory.persist.read",
          path: opts.rootDir,
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
          const result = parseMemoryMarkdown(text, filePath, id);
          if (result.isErr()) {
            throw new Error(result.error.message);
          }

          const tags = extractTags(text);

          return {
            meta: {
              id,
              title: result.value.title,
              tags,
              org: orgFromPath(filePath),
            },
            body: result.value.body,
          };
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

      return ResultAsync.fromPromise(
        (async () => {
          const targetDir = getArchiveDir(meta.org);
          if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
          }

          const existingFile = findEntryFile(meta.id);
          if (existingFile) {
            rmSync(existingFile, { force: true });
          }

          const filename = buildFilename(meta);
          const filePath = join(targetDir, filename);
          const content = serializeMemoryMarkdown(meta.title, meta.tags, body);

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
