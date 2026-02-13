/**
 * schemas for journal queue and memory entries.
 * journal queue: harness-agnostic entry format for adapters.
 * memory entry: tiered knowledge base with usage tracking (gilfoyle pattern).
 */

import { type } from "arktype";
import { ID_PATTERN } from "./id.js";

export const JournalQueueEntrySchema = type({
  version: '"1"',
  timestamp: "string",
  harness: "'amp' | 'cursor' | 'codex' | 'manual'",
  retrieval: {
    method: "'amp-thread' | 'cursor-session' | 'file'",
    "threadId?": "string",
    "sessionPath?": "string",
    "filePath?": "string",
  },
  context: {
    cwd: "string",
    "repo?": "string",
  },
});

export type JournalQueueEntry = typeof JournalQueueEntrySchema.infer;

export type JournalQueueError =
  | { _tag: "journal.write"; path: string; message: string }
  | { _tag: "journal.read"; path: string; message: string }
  | { _tag: "journal.validate"; path: string; message: string };

const MemorySourcesSchema = type({
  "harness?": "string",
  "threadId?": "string",
  "repo?": "string",
  "cwd?": "string",
});

export const MemoryEntryMetaSchema = type({
  id: type("string").matching(ID_PATTERN),
  title: "string >= 1",
  "tags?": "string[]",
  status: "'captured' | 'consolidated' | 'promoted'",
  used: "number >= 0",
  last_used: "string",
  pinned: "boolean",
  createdAt: "number",
  updatedAt: "number",
  "sources?": MemorySourcesSchema,
});

export type MemoryEntryMeta = typeof MemoryEntryMetaSchema.infer;

export interface MemoryEntry {
  meta: MemoryEntryMeta;
  body: string;
}
