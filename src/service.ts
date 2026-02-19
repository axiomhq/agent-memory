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
  };
}
