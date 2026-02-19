/**
 * memory doctor — health check for memory filesystem.
 */

import { join } from "path";
import { existsSync, readdirSync } from "fs";
import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter } from "../persist/filesystem.js";
import { isValidId } from "../id.js";

export interface HealthIssue {
  severity: "error" | "warning";
  message: string;
  location?: string;
}

export interface HealthCheckResult {
  entries: number;
  pendingQueue: number;
  errors: HealthIssue[];
  warnings: HealthIssue[];
}

export async function checkHealth(rootDir: string): Promise<HealthCheckResult> {
  const issues: HealthIssue[] = [];
  let totalEntries = 0;
  let pendingQueue = 0;

  if (!existsSync(rootDir)) {
    return {
      entries: 0,
      pendingQueue: 0,
      errors: [],
      warnings: [],
    };
  }

  const orgsDir = join(rootDir, "orgs");
  const inboxDir = join(rootDir, "inbox");

  if (existsSync(orgsDir)) {
    for (const orgEntry of readdirSync(orgsDir, { withFileTypes: true })) {
      if (!orgEntry.isDirectory()) continue;
      const archiveDir = join(orgsDir, orgEntry.name, "archive");
      if (!existsSync(archiveDir)) continue;

      for (const file of readdirSync(archiveDir)) {
        if (!file.endsWith(".md")) continue;

        const idMatch = file.match(/(id__[A-Za-z0-9]{6})/);
        if (!idMatch) {
          issues.push({
            severity: "warning",
            message: `file missing id in filename: ${file}`,
            location: archiveDir,
          });
          continue;
        }

        const id = idMatch[1];
        if (id && !isValidId(id)) {
          issues.push({
            severity: "error",
            message: `invalid id format: ${id}`,
            location: join(archiveDir, file),
          });
          continue;
        }

        totalEntries++;
      }
    }
  }

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

  return {
    entries: totalEntries,
    pendingQueue,
    errors: issues.filter((i) => i.severity === "error"),
    warnings: issues.filter((i) => i.severity === "warning"),
  };
}

export function formatHealthReport(result: HealthCheckResult, rootDir: string): string {
  const lines: string[] = [`checking: ${rootDir}\n`];

  lines.push(`entries: ${result.entries}`);
  lines.push(`pending queue: ${result.pendingQueue}`);
  lines.push(`errors: ${result.errors.length}`);
  lines.push(`warnings: ${result.warnings.length}`);

  const allIssues = [...result.errors, ...result.warnings];
  if (allIssues.length > 0) {
    lines.push("\nissues:");
    for (const issue of allIssues) {
      const icon = issue.severity === "error" ? "❌" : "⚠️";
      lines.push(`  ${icon} ${issue.message}`);
      if (issue.location) {
        lines.push(`     ${issue.location}`);
      }
    }
  } else {
    lines.push("\n✅ all checks passed");
  }

  return lines.join("\n");
}

export async function run(_args: string[]) {
  const config = loadConfig();
  const rootDir = expandPath(config.storage.root);

  console.log(`checking: ${rootDir}\n`);

  if (!existsSync(rootDir)) {
    console.log("❌ memory root does not exist");
    console.log("   run `memory capture` to create initial entry");
    return;
  }

  const result = await checkHealth(rootDir);

  console.log(`entries: ${result.entries}`);
  console.log(`pending queue: ${result.pendingQueue}`);
  console.log(`errors: ${result.errors.length}`);
  console.log(`warnings: ${result.warnings.length}`);

  const allIssues = [...result.errors, ...result.warnings];
  if (allIssues.length > 0) {
    console.log("\nissues:");
    for (const issue of allIssues) {
      const icon = issue.severity === "error" ? "❌" : "⚠️";
      console.log(`  ${icon} ${issue.message}`);
      if (issue.location) {
        console.log(`     ${issue.location}`);
      }
    }
  } else {
    console.log("\n✅ all checks passed");
  }

  if (result.errors.length > 0) {
    process.exit(1);
  }
}
