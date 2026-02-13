/**
 * memory consolidate — drain queue, run consolidation machine.
 */

import { parseArgs } from "util";
import { join } from "path";
import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter } from "../persist/filesystem.js";
import { createMemoryService } from "../service.js";
import { listPendingEntries, markProcessed } from "../journal.js";
import { buildConsolidationPrompt, type JournalForPrompt, type ExistingEntryRef } from "../prompts/consolidate.js";
import { executeShellLLM } from "../adapters/shell.js";
import { createActor } from "xstate";
import { consolidateMachine } from "../machines/consolidate.js";

export async function run(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      limit: { type: "string", short: "l", default: "10" },
    },
    strict: true,
  });

  const config = loadConfig();
  const rootDir = expandPath(config.storage.root);
  const inboxDir = join(rootDir, "inbox");

  const adapter = createFileMemoryPersistenceAdapter({ rootDir });
  const service = createMemoryService(adapter);

  const limit = parseInt(values.limit ?? "10", 10);

  const pending = listPendingEntries({ inboxDir });
  if (pending.isErr()) {
    console.error(`error: ${pending.error.message}`);
    process.exit(1);
  }

  if (pending.value.length === 0) {
    console.log("no pending journal entries");
    return;
  }

  const entriesToProcess = pending.value.slice(0, limit);

  const journals: JournalForPrompt[] = entriesToProcess.map((p) => ({
    id: p.id,
    title: `session ${p.entry.harness}`,
    body: `harness: ${p.entry.harness}\ncontext: ${p.entry.context.cwd}`,
    tags: [],
  }));

  const existingResult = await service.list();
  if (existingResult.isErr()) {
    console.error(`error: ${existingResult.error.message}`);
    process.exit(1);
  }

  const existingEntries: ExistingEntryRef[] = existingResult.value.map((m) => ({
    id: m.id,
    title: m.title,
    tags: m.tags ?? [],
  }));

  const prompt = buildConsolidationPrompt(journals, existingEntries);
  const agentOutput = await executeShellLLM(prompt, { command: config.llm.command });

  console.log("agent output:");
  console.log(agentOutput);

  console.log(`\nprocessed ${entriesToProcess.length} entries`);
}
