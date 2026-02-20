/**
 * memory capture — write a journal queue entry.
 */

import { parseArgs } from "util";
import { join } from "path";
import { loadConfig, expandPath } from "../config.js";
import { writeJournalEntry } from "../journal.js";
import type { JournalQueueEntry } from "../schema.js";

export async function run(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      title: { type: "string", short: "t" },
      body: { type: "string", short: "b" },
      tags: { type: "string", short: "g", multiple: true },
      harness: { type: "string", default: "manual" },
      "thread-id": { type: "string" },
      cwd: { type: "string", default: process.cwd() },
      repo: { type: "string" },
    },
    strict: true,
  });

  if (!values.title || !values.body) {
    console.error("usage: memory capture --title <title> --body <body> [--tags <tag>...] [--harness <amp|codex|manual>] [--thread-id <id>]");
    process.exit(1);
  }

  const config = loadConfig();
  const inboxDir = join(expandPath(config.storage.root), "inbox");

  const entry: JournalQueueEntry = {
    version: "1" as const,
    timestamp: new Date().toISOString(),
    harness: values.harness as JournalQueueEntry["harness"],
    retrieval: values["thread-id"]
      ? { method: "amp-thread" as const, threadId: values["thread-id"] }
      : { method: "file" as const, content: values.body! },
    context: {
      cwd: values.cwd ?? process.cwd(),
      ...(values.repo ? { repo: values.repo } : {}),
    },
  };

  const result = writeJournalEntry(entry, { inboxDir });
  if (result.isErr()) {
    console.error(`error: ${result.error.message}`);
    process.exit(1);
  }

  console.log(`captured: ${result.value}`);
}
