/**
 * memory uninstall-cron — unload and remove launchd plists.
 */

import { existsSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { $ } from "bun";

const LAUNCH_AGENTS = join(homedir(), "Library", "LaunchAgents");

export async function run(_args: string[]) {
  const consolidatePath = join(LAUNCH_AGENTS, "com.agent-memory.consolidate.plist");
  const defragPath = join(LAUNCH_AGENTS, "com.agent-memory.defrag.plist");

  for (const plistPath of [consolidatePath, defragPath]) {
    if (existsSync(plistPath)) {
      try {
        await $`launchctl unload ${plistPath}`.quiet();
      } catch {
        // may not be loaded
      }
      rmSync(plistPath, { force: true });
      console.log(`removed: ${plistPath}`);
    }
  }

  console.log("cron jobs uninstalled");
}
