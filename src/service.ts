/**
 * memory service — high-level API over the persistence adapter.
 * handles ID generation and CRUD operations.
 *
 * WHY no usage tracking: read() is now a pure read with no side effects.
 * agents bypass service.read() via grep/file tools, making usage counters
 * unreliable. removed per notes-and-links ADR.
 */

import { ResultAsync } from "neverthrow";
import { generateId } from "./id.js";
import { extractLinks } from "./links.js";
import type { MemoryEntry, MemoryEntryMeta } from "./schema.js";
import type { MemoryPersistenceAdapter, MemoryPersistenceError, MemoryListFilter } from "./persist/index.js";

export interface CaptureInput {
  title: string;
  body: string;
  tags?: string[];
  sources?: MemoryEntryMeta["sources"];
  org?: string;
}

export interface MemoryService {
  capture(input: CaptureInput): ResultAsync<MemoryEntry, MemoryPersistenceError>;
  list(filter?: MemoryListFilter): ResultAsync<MemoryEntryMeta[], MemoryPersistenceError>;
  read(id: string): ResultAsync<MemoryEntry, MemoryPersistenceError>;
  remove(id: string): ResultAsync<void, MemoryPersistenceError>;
  updateMeta(
    id: string,
    patch: Partial<Pick<MemoryEntryMeta, "tags" | "title">>,
  ): ResultAsync<void, MemoryPersistenceError>;
  updateBody(id: string, body: string): ResultAsync<void, MemoryPersistenceError>;
  rename(id: string, newTitle: string): ResultAsync<{ updatedInboundLinks: number }, MemoryPersistenceError>;
  links(id: string): ResultAsync<{
    inbound: Array<{ id: string; title: string }>;
    outbound: Array<{ id: string; displayText: string }>;
  }, MemoryPersistenceError>;
  orphans(): ResultAsync<string[], MemoryPersistenceError>;
  brokenLinks(): ResultAsync<Array<{ sourceId: string; targetId: string }>, MemoryPersistenceError>;
}

export function createMemoryService(adapter: MemoryPersistenceAdapter): MemoryService {
  return {
    capture(input: CaptureInput): ResultAsync<MemoryEntry, MemoryPersistenceError> {
      return ResultAsync.fromPromise(
        (async () => {
          const now = Date.now();
          const id = await generateId(input.title, now);

          const entry: MemoryEntry = {
            meta: {
              id,
              title: input.title,
              tags: input.tags ?? [],
              createdAt: now,
              updatedAt: now,
              ...(input.sources ? { sources: input.sources } : {}),
              ...(input.org ? { org: input.org } : {}),
            },
            body: input.body,
          };

          const result = await adapter.write(entry);
          if (result.isErr()) {
            throw result.error;
          }
          return entry;
        })(),
        (e): MemoryPersistenceError => {
          if ((e as { _tag?: string })._tag?.startsWith("memory.persist")) {
            return e as MemoryPersistenceError;
          }
          return {
            _tag: "memory.persist.write",
            path: "",
            message: e instanceof Error ? e.message : String(e),
          };
        },
      );
    },

    list(filter?: MemoryListFilter): ResultAsync<MemoryEntryMeta[], MemoryPersistenceError> {
      return adapter.list(filter);
    },

    read(id: string): ResultAsync<MemoryEntry, MemoryPersistenceError> {
      return adapter.read(id);
    },

    remove(id: string): ResultAsync<void, MemoryPersistenceError> {
      return adapter.delete(id);
    },

    updateMeta(
      id: string,
      patch: Partial<Pick<MemoryEntryMeta, "tags" | "title">>,
    ): ResultAsync<void, MemoryPersistenceError> {
      return adapter.read(id).andThen((entry: MemoryEntry) => {
        const updated: MemoryEntry = {
          meta: {
            ...entry.meta,
            ...patch,
            updatedAt: Date.now(),
          },
          body: entry.body,
        };
        return adapter.write(updated);
      });
    },

    updateBody(id: string, body: string): ResultAsync<void, MemoryPersistenceError> {
      return adapter.read(id).andThen((entry: MemoryEntry) => {
        const updated: MemoryEntry = {
          meta: { ...entry.meta, updatedAt: Date.now() },
          body,
        };
        return adapter.write(updated);
      });
    },

    rename(
      id: string,
      newTitle: string,
    ): ResultAsync<{ updatedInboundLinks: number }, MemoryPersistenceError> {
      return ResultAsync.fromPromise(
        (async () => {
          // 1. read the entry being renamed
          const readResult = await adapter.read(id);
          if (readResult.isErr()) throw readResult.error;
          const entry = readResult.value;
          const oldTitle = entry.meta.title;

          // 2. update title — body stays the same (heading is separate from body)
          const updated: MemoryEntry = {
            meta: { ...entry.meta, title: newTitle, updatedAt: Date.now() },
            body: entry.body,
          };
          const writeResult = await adapter.write(updated);
          if (writeResult.isErr()) throw writeResult.error;

          // 3. scan all entries for inbound links to this id, update display text
          let updatedInboundLinks = 0;
          const allEntries = await adapter.list();
          if (allEntries.isErr()) throw allEntries.error;

          for (const meta of allEntries.value) {
            if (meta.id === id) continue;

            const otherResult = await adapter.read(meta.id);
            if (otherResult.isErr()) continue;

            const links = extractLinks(otherResult.value.body);
            const inboundLinks = links.filter((l) => l.id === id);
            if (inboundLinks.length === 0) continue;

            // only update display text that matches old title
            let updatedBody = otherResult.value.body;
            let changed = false;
            for (const link of inboundLinks) {
              if (link.displayText === oldTitle) {
                const oldLink = `[[${id}|${oldTitle}]]`;
                const newLink = `[[${id}|${newTitle}]]`;
                updatedBody = updatedBody.replace(oldLink, newLink);
                changed = true;
              }
            }

            if (changed) {
              const otherUpdated: MemoryEntry = {
                meta: { ...otherResult.value.meta, updatedAt: Date.now() },
                body: updatedBody,
              };
              const otherWrite = await adapter.write(otherUpdated);
              if (otherWrite.isOk()) updatedInboundLinks++;
            }
          }

          return { updatedInboundLinks };
        })(),
        (e): MemoryPersistenceError => {
          if ((e as { _tag?: string })._tag?.startsWith("memory.persist")) {
            return e as MemoryPersistenceError;
          }
          return {
            _tag: "memory.persist.write",
            path: id,
            message: e instanceof Error ? e.message : String(e),
          };
        },
      );
    },

    links(id: string) {
      return ResultAsync.fromPromise(
        (async () => {
          // outbound: links in this entry's body
          const readResult = await adapter.read(id);
          if (readResult.isErr()) throw readResult.error;
          const outbound = extractLinks(readResult.value.body).map((l) => ({
            id: l.id,
            displayText: l.displayText,
          }));

          // inbound: other entries that link to this id
          const allEntries = await adapter.list();
          if (allEntries.isErr()) throw allEntries.error;

          const inbound: Array<{ id: string; title: string }> = [];
          for (const meta of allEntries.value) {
            if (meta.id === id) continue;
            const otherResult = await adapter.read(meta.id);
            if (otherResult.isErr()) continue;
            const otherLinks = extractLinks(otherResult.value.body);
            if (otherLinks.some((l) => l.id === id)) {
              inbound.push({ id: meta.id, title: meta.title });
            }
          }

          return { inbound, outbound };
        })(),
        (e): MemoryPersistenceError => ({
          _tag: "memory.persist.read",
          path: id,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    },

    orphans() {
      return ResultAsync.fromPromise(
        (async () => {
          const allEntries = await adapter.list();
          if (allEntries.isErr()) throw allEntries.error;

          // build set of all ids that are linked to from any entry
          const linkedTo = new Set<string>();
          for (const meta of allEntries.value) {
            const readResult = await adapter.read(meta.id);
            if (readResult.isErr()) continue;
            for (const link of extractLinks(readResult.value.body)) {
              linkedTo.add(link.id);
            }
          }

          // orphans: entries with zero inbound links
          return allEntries.value
            .filter((meta) => !linkedTo.has(meta.id))
            .map((meta) => meta.id);
        })(),
        (e): MemoryPersistenceError => ({
          _tag: "memory.persist.read",
          path: "",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    },

    brokenLinks() {
      return ResultAsync.fromPromise(
        (async () => {
          const allEntries = await adapter.list();
          if (allEntries.isErr()) throw allEntries.error;

          const existingIds = new Set(allEntries.value.map((m) => m.id));
          const broken: Array<{ sourceId: string; targetId: string }> = [];

          for (const meta of allEntries.value) {
            const readResult = await adapter.read(meta.id);
            if (readResult.isErr()) continue;
            for (const link of extractLinks(readResult.value.body)) {
              if (!existingIds.has(link.id)) {
                broken.push({ sourceId: meta.id, targetId: link.id });
              }
            }
          }

          return broken;
        })(),
        (e): MemoryPersistenceError => ({
          _tag: "memory.persist.read",
          path: "",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    },
  };
}
