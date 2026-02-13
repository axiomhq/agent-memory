/**
 * memory doctor — health check for memory filesystem.
 */

import { join } from "path";
import { existsSync, readdirSync } from "fs";
import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter } from "../persist/filesystem.js";
import { isValidId } from "../id.js";

interface HealthIssue {
  severity: "error" | "warning";
  message: string;
  location?: string;
}

export async function run(_args: string[]) {
  const config = loadConfig();
  const rootDir = expandPath(config.storage.root);
  const issues: HealthIssue[] = [];

  console.log(`checking: ${rootDir}\n`);

  if (!existsSync(rootDir)) {
    console.log("❌ memory root does not exist");
    console.log("   run `memory capture` to create initial entry");
    return;
  }

  const topicsDir = join(rootDir, "topics");
  const archiveDir = join(rootDir, "archive");
  const inboxDir = join(rootDir, "inbox");

  let totalEntries = 0;

  for (const dir of [topicsDir, archiveDir]) {
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;

      const idMatch = file.match(/(id__[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6})/);
      if (!idMatch) {
        issues.push({
          severity: "warning",
          message: `file missing id in filename: ${file}`,
          location: dir,
        });
        continue;
      }

      const id = idMatch[1];
      if (id && !isValidId(id)) {
        issues.push({
          severity: "error",
          message: `invalid id format: ${id}`,
          location: join(dir, file),
        });
      }

      totalEntries++;
    }
  }

  let pendingQueue = 0;
  if (existsSync(inboxDir)) {
    for (const file of readdirSync(inboxDir)) {
      if (file.endsWith(".json") && !file.startsWith(".")) {
        pendingQueue++;
      }
    }
  }

  const adapter = createFileMemoryPersistenceAdapter({ rootDir });
  const listResult = await adapter.list();

  if (listResult.isErr()) {
    issues.push({
      severity: "error",
      message: `failed to list entries: ${listResult.error.message}`,
    });
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  console.log(`entries: ${totalEntries}`);
  console.log(`pending queue: ${pendingQueue}`);
  console.log(`errors: ${errorCount}`);
  console.log(`warnings: ${warningCount}`);

  if (issues.length > 0) {
    console.log("\nissues:");
    for (const issue of issues) {
      const icon = issue.severity === "error" ? "❌" : "⚠️";
      console.log(`  ${icon} ${issue.message}`);
      if (issue.location) {
        console.log(`     ${issue.location}`);
      }
    }
  } else {
    console.log("\n✅ all checks passed");
  }

  if (errorCount > 0) {
    process.exit(1);
  }
}
