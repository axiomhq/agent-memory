/**
 * memory generate-agents-md — regenerate AGENTS.md standalone.
 */

import { parseArgs } from "util";
import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter } from "../persist/filesystem.js";
import { replaceAgentsMdSection, generateAgentsMdSection } from "../agents-md/generator.js";

export async function run(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      target: { type: "string", short: "t" },
    },
    strict: true,
  });

  const config = loadConfig();
  const rootDir = expandPath(config.storage.root);

  const adapter = createFileMemoryPersistenceAdapter({ rootDir });

  const listResult = await adapter.list();
  if (listResult.isErr()) {
    console.error(`error: ${listResult.error.message}`);
    process.exit(1);
  }

  const entries = listResult.value;

  // without defrag agent, no top-of-mind entries — all listed as links
  const section = generateAgentsMdSection([], entries);

  const targets = values.target ? [values.target] : config.agentsMd.targets;

  for (const target of targets) {
    const targetPath = expandPath(target);
    replaceAgentsMdSection(targetPath, section);
    console.log(`updated: ${targetPath}`);
  }
}
