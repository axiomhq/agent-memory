/**
 * journal queue operations — write, list, mark processed.
 * queue entries live in inbox/ as JSON files.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import { type } from "arktype";
import { JournalQueueEntrySchema, type JournalQueueEntry, type JournalQueueError } from "./schema.js";
import { ok, err, type Result } from "neverthrow";

export interface JournalQueueOptions {
  inboxDir: string;
}

function formatTimestampForFilename(iso: string): string {
  return iso.replace(/[:.]/g, "-").replace("T", "T").slice(0, 19);
}

export function writeJournalEntry(
  entry: JournalQueueEntry,
  options: JournalQueueOptions,
): Result<string, JournalQueueError> {
  const validated = JournalQueueEntrySchema(entry);
  if (validated instanceof type.errors) {
    return err({
      _tag: "journal.validate",
      path: "",
      message: `schema validation failed: ${validated.summary}`,
    });
  }

  if (!existsSync(options.inboxDir)) {
    mkdirSync(options.inboxDir, { recursive: true });
  }

  const timestamp = formatTimestampForFilename(entry.timestamp);
  const filename = `${timestamp}_${entry.harness}_${nanoid(6)}.json`;
  const filePath = join(options.inboxDir, filename);

  try {
    writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
    return ok(filePath);
  } catch (e) {
    return err({
      _tag: "journal.write",
      path: filePath,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export interface PendingEntry {
  id: string;
  path: string;
  entry: JournalQueueEntry;
}

export function listPendingEntries(options: JournalQueueOptions): Result<PendingEntry[], JournalQueueError> {
  if (!existsSync(options.inboxDir)) {
    return ok([]);
  }

  const processedDir = join(options.inboxDir, ".processed");
  const results: PendingEntry[] = [];

  try {
    for (const file of readdirSync(options.inboxDir)) {
      if (!file.endsWith(".json")) continue;

      const filePath = join(options.inboxDir, file);
      try {
        const text = readFileSync(filePath, "utf-8");
        const parsed: unknown = JSON.parse(text);
        const validated = JournalQueueEntrySchema(parsed);
        if (validated instanceof type.errors) continue;

        results.push({
          id: file.replace(".json", ""),
          path: filePath,
          entry: validated,
        });
      } catch {
        continue;
      }
    }

    results.sort((a, b) => a.entry.timestamp.localeCompare(b.entry.timestamp));
    return ok(results);
  } catch (e) {
    return err({
      _tag: "journal.read",
      path: options.inboxDir,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export function markProcessed(entryId: string, options: JournalQueueOptions): Result<void, JournalQueueError> {
  const processedDir = join(options.inboxDir, ".processed");
  const sourcePath = join(options.inboxDir, `${entryId}.json`);
  const destPath = join(processedDir, `${entryId}.json`);

  if (!existsSync(processedDir)) {
    mkdirSync(processedDir, { recursive: true });
  }

  try {
    renameSync(sourcePath, destPath);
    return ok(undefined);
  } catch (e) {
    return err({
      _tag: "journal.write",
      path: sourcePath,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
