/**
 * consolidation adapters — I/O boundaries for the consolidation machine.
 * per INJECT AT THE BOUNDARY: adapter interfaces declared here, implementations wrap real I/O.
 */

import type { JournalQueueEntry } from "../schema.js";
import type { JournalForPrompt, ExistingEntryRef } from "../prompts/consolidate.js";

export interface ConsolidateAdapters {
  loadQueue(limit: number): Promise<{
    entries: Array<{ id: string; entry: JournalQueueEntry }>;
    journals: JournalForPrompt[];
  }>;
  fetchHistory(entries: Array<{ id: string; entry: JournalQueueEntry }>): Promise<string>;
  listExistingEntries(): Promise<ExistingEntryRef[]>;
  executeAgent(prompt: string): Promise<string>;
  writeKbEntry(input: { title: string; body: string; tags: string[] }): Promise<string>;
  updateKbEntryBody(id: string, body: string): Promise<void>;
  markProcessed(queueId: string, kbIds: string[]): Promise<void>;
  commitChanges(message: string): Promise<void>;
}
