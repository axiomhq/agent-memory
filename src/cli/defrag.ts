/**
 * memory defrag — run defrag, update top-of-mind filenames, regenerate AGENTS.md.
 */

import { join } from "path";
import { readdirSync } from "fs";
import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter, isTopOfMindFilename, setTopOfMind } from "../persist/filesystem.js";
import { createMemoryService } from "../service.js";
import { buildDefragPrompt, parseDefragOutput, type EntryForDefrag } from "../prompts/defrag.js";
import { executeShellLLM } from "../adapters/shell.js";
import { replaceAgentsMdSection, generateAgentsMdSection } from "../agents-md/generator.js";

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
        used: meta.used,
        last_used: meta.last_used,
        topOfMind: false, // will be determined from filename in a real scan
        status: meta.status,
      });
    }
  }

  const prompt = buildDefragPrompt(entries);
  const agentOutput = await executeShellLLM(prompt, { command: config.llm.command });

  const decision = parseDefragOutput(agentOutput);

  console.log(`defrag complete:`);
  console.log(`  actions: ${decision.actions.length}`);
  console.log(`  top-of-mind: ${decision.topOfMind.length}`);

  const topOfMindSet = new Set(decision.topOfMind);

  for (const entry of entries) {
    setTopOfMind(rootDir, entry.id, topOfMindSet.has(entry.id));
  }

  const topOfMindEntries = await Promise.all(
    entries
      .filter((e) => topOfMindSet.has(e.id))
      .map(async (e) => {
        const result = await adapter.read(e.id);
        return result.isOk() ? { meta: result.value.meta, body: result.value.body } : null;
      }),
  );

  const hotEntries = topOfMindEntries.filter((e): e is NonNullable<typeof e> => e !== null);
  const archiveEntries = listResult.value.filter((e) => !topOfMindSet.has(e.id));

  const section = generateAgentsMdSection(hotEntries, archiveEntries);

  for (const target of config.agentsMd.targets) {
    const targetPath = expandPath(target);
    replaceAgentsMdSection(targetPath, section);
    console.log(`  updated: ${targetPath}`);
  }
}
