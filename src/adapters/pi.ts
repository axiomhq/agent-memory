/**
 * pi harness adapter — writes journal entries, reads session history.
 *
 * pi sessions are .jsonl files (one JSON object per line).
 * fetchPiSessionHistory reads the file directly and extracts assistant
 * text content — no subprocess needed, unlike the amp adapter.
 */

import type { JournalQueueEntry } from "../schema.js";
import { writeJournalEntry, type JournalQueueOptions } from "../journal.js";

export interface PiAdapterOptions extends JournalQueueOptions {
  cwd?: string;
}

export async function writePiJournalEntry(
  sessionPath: string,
  cwd: string,
  repo: string | undefined,
  options: PiAdapterOptions,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const entry: JournalQueueEntry = {
    version: "1",
    timestamp: new Date().toISOString(),
    harness: "pi",
    retrieval: {
      method: "pi-session",
      sessionPath,
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

/**
 * reads a pi .jsonl session file and extracts assistant text content.
 *
 * each line is a JSON object. assistant messages have role: "assistant"
 * with content as either a plain string or an array of typed blocks
 * (where text blocks have { type: "text", text: "..." }).
 */
export async function fetchPiSessionHistory(sessionPath: string): Promise<string> {
  const file = Bun.file(sessionPath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`pi session file not found: ${sessionPath}`);
  }

  const raw = await file.text();
  const lines = raw.trim().split("\n").filter(Boolean);
  const parts: string[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.role === "assistant" && obj.content) {
        if (typeof obj.content === "string") {
          parts.push(obj.content);
        } else if (Array.isArray(obj.content)) {
          for (const block of obj.content) {
            if (block.type === "text" && typeof block.text === "string") {
              parts.push(block.text);
            }
          }
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  if (parts.length === 0) {
    throw new Error(`no assistant content found in session: ${sessionPath}`);
  }

  return parts.join("\n\n");
}

export function buildPiAfterSessionHook(
  inboxDir: string,
): (sessionPath: string, cwd: string, repo?: string) => Promise<void> {
  return async (sessionPath: string, cwd: string, repo?: string) => {
    const result = await writePiJournalEntry(sessionPath, cwd, repo, { inboxDir });
    if (!result.success) {
      console.error(`failed to write journal entry: ${result.error}`);
    }
  };
}
