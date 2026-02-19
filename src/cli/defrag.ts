/**
 * memory defrag — run defrag machine, regenerate AGENTS.md.
 */

import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter } from "../persist/filesystem.js";
import { createMemoryService } from "../service.js";
import { buildDefragPrompt, parseDefragOutput, type EntryForDefrag } from "../prompts/defrag.js";
import { executeShellLLM } from "../adapters/shell.js";
import { replaceAgentsMdSection, generateAgentsMdSection } from "../agents-md/generator.js";
import type { EntryWithBody } from "../agents-md/generator.js";

export async function run(_args: string[]) {
  const config = loadConfig();
  const rootDir = expandPath(config.storage.root);

  const adapter = createFileMemoryPersistenceAdapter({ rootDir });
  const service = createMemoryService(adapter);

  const listResult = await service.list();
  if (listResult.isErr()) {
    console.error(`error: ${listResult.error.message}`);
    process.exit(1);
  }

  if (listResult.value.length === 0) {
    console.log("no entries to defrag");
    return;
  }

  const entries: EntryForDefrag[] = [];
  for (const meta of listResult.value) {
    const readResult = await adapter.read(meta.id);
    if (readResult.isOk()) {
      entries.push({
        id: meta.id,
        title: meta.title,
        body: readResult.value.body,
        tags: meta.tags ?? [],
      });
    }
  }

  const prompt = buildDefragPrompt(entries);
  const agentOutput = await executeShellLLM(prompt, { command: config.llm.command });

  const decision = parseDefragOutput(agentOutput);

  console.log(`defrag complete:`);
  console.log(`  actions: ${decision.actions.length}`);
  console.log(`  top of mind: ${decision.topOfMind.length}`);

  const topOfMindSet = new Set(decision.topOfMind);

  const topOfMindEntries: EntryWithBody[] = entries
    .filter((e) => topOfMindSet.has(e.id))
    .map((e) => ({
      meta: {
        id: e.id,
        title: e.title,
        tags: e.tags,
        org: "default",
      },
      body: e.body,
    }));

  const allEntries = listResult.value;

  const section = generateAgentsMdSection(topOfMindEntries, allEntries);

  for (const target of config.agentsMd.targets) {
    const targetPath = expandPath(target);
    replaceAgentsMdSection(targetPath, section);
    console.log(`  updated: ${targetPath}`);
  }
}
