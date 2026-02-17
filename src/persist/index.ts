import type { ResultAsync } from "neverthrow";
import type { MemoryEntry, MemoryEntryMeta } from "../schema.js";

export type MemoryPersistenceError =
  | { _tag: "memory.persist.read"; path: string; message: string }
  | { _tag: "memory.persist.write"; path: string; message: string }
  | { _tag: "memory.persist.delete"; path: string; message: string }
  | { _tag: "memory.persist.parse"; path: string; message: string };

export interface MemoryListFilter {
  status?: MemoryEntryMeta["status"];
  query?: string;
  limit?: number;
  tags?: string[];
  org?: string;
}

export interface MemoryPersistenceAdapter {
  list(filter?: MemoryListFilter): ResultAsync<MemoryEntryMeta[], MemoryPersistenceError>;
  read(id: string): ResultAsync<MemoryEntry, MemoryPersistenceError>;
  write(entry: MemoryEntry): ResultAsync<void, MemoryPersistenceError>;
  delete(id: string): ResultAsync<void, MemoryPersistenceError>;
}
