/**
 * memory list — list entries with metadata.
 */

import { parseArgs } from "util";
import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter } from "../persist/filesystem.js";
import { createMemoryService } from "../service.js";

export async function run(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      status: { type: "string", short: "s" },
      query: { type: "string", short: "q" },
      limit: { type: "string", short: "l", default: "20" },
    },
    strict: true,
  });

  const config = loadConfig();
  const rootDir = expandPath(config.storage.root);

  const adapter = createFileMemoryPersistenceAdapter({ rootDir });
  const service = createMemoryService(adapter);

  const limit = parseInt(values.limit ?? "20", 10);

  const result = await service.list({
    status: values.status as "captured" | "consolidated" | "promoted" | undefined,
    query: values.query,
    limit,
  });

  if (result.isErr()) {
    console.error(`error: ${result.error.message}`);
    process.exit(1);
  }

  if (result.value.length === 0) {
    console.log("no entries found");
    return;
  }

  console.log(`found ${result.value.length} entries:\n`);

  for (const entry of result.value) {
    const tags = entry.tags?.length ? ` [${entry.tags.join(", ")}]` : "";
    const pinned = entry.pinned ? " 📌" : "";
    console.log(`${entry.id}: "${entry.title}"${tags}${pinned}`);
    console.log(`  used: ${entry.used} | status: ${entry.status} | last: ${entry.last_used}`);
  }
}
