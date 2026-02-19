/**
 * memory read — read entry (pure read, no side effects).
 */

import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter } from "../persist/filesystem.js";
import { createMemoryService } from "../service.js";

export async function run(args: string[]) {
  if (args.length === 0) {
    console.error("usage: memory read <id>");
    process.exit(1);
  }

  const id = args[0]!;

  const config = loadConfig();
  const rootDir = expandPath(config.storage.root);

  const adapter = createFileMemoryPersistenceAdapter({ rootDir });
  const service = createMemoryService(adapter);

  const result = await service.read(id);

  if (result.isErr()) {
    console.error(`error: ${result.error.message}`);
    process.exit(1);
  }

  const entry = result.value;
  const tags = entry.meta.tags?.length ? ` [${entry.meta.tags.join(", ")}]` : "";

  console.log(`---`);
  console.log(`id: ${entry.meta.id}`);
  console.log(`title: ${entry.meta.title}${tags}`);
  console.log(`---\n`);
  console.log(entry.body);
}
