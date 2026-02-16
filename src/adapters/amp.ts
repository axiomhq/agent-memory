/**
 * amp harness adapter — writes journal entries, fetches thread history.
 * does NOT depend on @sourcegraph/amp-sdk — uses CLI or direct file write.
 */

import { join } from "path";
import type { JournalQueueEntry } from "../schema.js";
import { writeJournalEntry, type JournalQueueOptions } from "../journal.js";

export interface AmpAdapterOptions extends JournalQueueOptions {
  cwd?: string;
}

export async function writeAmpJournalEntry(
  threadId: string,
  cwd: string,
  repo: string | undefined,
  options: AmpAdapterOptions,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const entry: JournalQueueEntry = {
    version: "1",
    timestamp: new Date().toISOString(),
    harness: "amp",
    retrieval: {
      method: "amp-thread",
      threadId,
    },
    context: {
      cwd,
      ...(repo ? { repo } : {}),
    },
  };

  const result = writeJournalEntry(entry, { inboxDir: options.inboxDir });
  if (result.isErr()) {
    return { success: false, error: result.error.message };
  }

  return { success: true, path: result.value };
}

export async function fetchAmpThreadHistory(threadId: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["amp", "thread", "read", threadId],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`amp thread read failed: ${stderr}`);
  }

  return stdout;
}

export function buildAmpAfterSessionHook(
  inboxDir: string,
): (threadId: string, cwd: string, repo?: string) => Promise<void> {
  return async (threadId: string, cwd: string, repo?: string) => {
    const result = await writeAmpJournalEntry(threadId, cwd, repo, { inboxDir });
    if (!result.success) {
      console.error(`failed to write journal entry: ${result.error}`);
    }
  };
}
