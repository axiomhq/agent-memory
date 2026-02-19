/**
 * schemas for journal queue and memory entries.
 * journal queue: harness-agnostic entry format for adapters.
 * memory entry: pure markdown with derived metadata (notes-and-links model).
 *
 * WHY no stored metadata: entries are plain markdown files. id from filename,
 * title from # heading, tags from #tag in body, timestamps from git history.
 * nothing is written to disk as metadata — all fields are derived at read time.
 */

import { type } from "arktype";

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

export type MemorySources = typeof MemorySourcesSchema.infer;

/**
 * runtime memory entry metadata — all fields derived at read time.
 * id: from filename (id__XXXXXX pattern).
 * title: from # heading in body.
 * tags: from #tag syntax in body.
 * createdAt/updatedAt: from git history (fallback to Date.now() for uncommitted).
 * sources/org: optional, passed at capture time and stored inline.
 */
export interface MemoryEntryMeta {
  id: string;
  title: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sources?: MemorySources;
  org?: string;
}

export interface MemoryEntry {
  meta: MemoryEntryMeta;
  body: string;
}
