/**
 * memory generate-agents-md — regenerate output-agents.md per org standalone.
 */

import { join } from "path";
import { parseArgs } from "util";
import { mkdirSync, existsSync } from "fs";
import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter } from "../persist/filesystem.js";
import { replaceAgentsMdSection, generateAgentsMdSection } from "../agents-md/generator.js";

export async function run(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      org: { type: "string", short: "o" },
    },
    strict: true,
  });

  const org = values.org ?? "default";
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

  const targetDir = join(rootDir, "orgs", org);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  const targetPath = join(targetDir, "output-agents.md");
  replaceAgentsMdSection(targetPath, section);
  console.log(`updated: ${targetPath}`);
}
