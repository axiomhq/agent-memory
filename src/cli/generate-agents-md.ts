/**
 * memory generate-agents-md — regenerate AGENTS.md standalone.
 *
 * reads top-of-mind status from filenames (not metadata).
 */

import { parseArgs } from "util";
import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter, isTopOfMindFilename } from "../persist/filesystem.js";
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

  const topOfMindIds = new Set<string>();
  const orgsDir = join(rootDir, "orgs");
  if (existsSync(orgsDir)) {
    for (const org of readdirSync(orgsDir, { withFileTypes: true })) {
      if (!org.isDirectory()) continue;
      const archiveDir = join(orgsDir, org.name, "archive");
      if (!existsSync(archiveDir)) continue;
      for (const file of readdirSync(archiveDir)) {
        if (isTopOfMindFilename(file)) {
          const match = file.match(/(id__[a-zA-Z0-9]{6})/);
          if (match) topOfMindIds.add(match[1]!);
        }
      }
    }
  }

  const topOfMindWithBody = await Promise.all(
    entries
      .filter((e) => topOfMindIds.has(e.id))
      .map(async (meta) => {
        const result = await adapter.read(meta.id);
        return result.isOk() ? { meta, body: result.value.body } : null;
      }),
  );

  const hotEntries = topOfMindWithBody.filter((e): e is NonNullable<typeof e> => e !== null);
  const archiveEntries = entries.filter((e) => !topOfMindIds.has(e.id));

  const section = generateAgentsMdSection(hotEntries, archiveEntries);

  const targets = values.target ? [values.target] : config.agentsMd.targets;

  for (const target of targets) {
    const targetPath = expandPath(target);
    replaceAgentsMdSection(targetPath, section);
    console.log(`updated: ${targetPath}`);
  }
}
