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

  // without usage tracking, all entries are warm by default.
  // hot tier determined by defrag agent, not heuristics.
  const hotEntries: Array<{ meta: (typeof entries)[number]; body: string }> = [];
  const warmEntries = entries.map((meta) => ({
    meta,
    path: `${rootDir}/orgs/default/archive/${meta.id}.md`,
  }));

  const section = generateAgentsMdSection(hotEntries, warmEntries);

  const targets = values.target ? [values.target] : config.agentsMd.targets;

  for (const target of targets) {
    const targetPath = expandPath(target);
    replaceAgentsMdSection(targetPath, section);
    console.log(`updated: ${targetPath}`);
  }
}
