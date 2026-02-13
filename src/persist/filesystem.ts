/**
 * file-based memory persistence adapter.
 * directory layout: inbox/, topics/, archive/
 * filename convention: descriptive-title -- topic__x topic__y id__XXXXXX.md
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, renameSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { ResultAsync, errAsync } from "neverthrow";
import { type } from "arktype";
import { isValidId } from "../id.js";
import { serializeMemoryMarkdown, parseMemoryMarkdown } from "../format.js";
import { MemoryEntryMetaSchema, type MemoryEntry, type MemoryEntryMeta } from "../schema.js";
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
  const tagsPart = (meta.tags ?? [])
    .filter((t) => t.startsWith("topic__"))
    .map((t) => t.replace("topic__", "").replace(/[^a-z0-9]/g, ""))
    .slice(0, 3)
    .join(" ");
  const idPart = meta.id;

  if (tagsPart) {
    return `${titlePart} -- ${tagsPart} ${idPart}.md`;
  }
  return `${titlePart} ${idPart}.md`;
}

function extractIdFromFilename(filename: string): string | null {
  const match = filename.match(/(id__[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6})\.md$/);
  return match?.[1] ?? null;
}

interface FileAdapterOptions {
  rootDir: string;
}

function readEntriesFromDir(dir: string): Array<{ meta: MemoryEntryMeta; filePath: string }> {
  if (!existsSync(dir)) return [];

  const results: Array<{ meta: MemoryEntryMeta; filePath: string }> = [];

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

      results.push({ meta: result.value.meta, filePath });
    } catch {
      continue;
    }
  }

  return results;
}

const TOPICS_DIR = "topics";
const ARCHIVE_DIR = "archive";

export function createFileMemoryPersistenceAdapter(options: FileAdapterOptions): MemoryPersistenceAdapter {
  const opts: Required<FileAdapterOptions> = {
    rootDir: options.rootDir,
  };

  const topicsDir = join(opts.rootDir, TOPICS_DIR);
  const archiveDir = join(opts.rootDir, ARCHIVE_DIR);

  function findEntryFile(id: string): string | null {
    for (const dir of [topicsDir, archiveDir]) {
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

          for (const dir of [topicsDir, archiveDir]) {
            entries.push(...readEntriesFromDir(dir).map((e) => e.meta));
          }

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
          const targetDir = meta.status === "promoted" ? topicsDir : topicsDir;
          if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
          }

          const existingFile = findEntryFile(meta.id);
          if (existingFile) {
            rmSync(existingFile, { force: true });
          }

          const filename = buildFilename(meta);
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
