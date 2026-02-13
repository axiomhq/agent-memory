/**
 * memory install-cron — symlink and load launchd plists.
 */

import { existsSync, symlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { loadConfig } from "../config.js";

const LAUNCH_AGENTS = join(homedir(), "Library", "LaunchAgents");

function plistContent(name: string, command: string, intervalHours: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agent-memory.${name}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/memory</string>
        <string>${command}</string>
    </array>
    <key>StartInterval</key>
    <integer>${intervalHours * 60 * 60}</integer>
    <key>StandardOutPath</key>
    <string>/tmp/agent-memory-${name}.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/agent-memory-${name}.log</string>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>`;
}

export async function run(_args: string[]) {
  const config = loadConfig();

  if (!existsSync(LAUNCH_AGENTS)) {
    mkdirSync(LAUNCH_AGENTS, { recursive: true });
  }

  const consolidatePlist = plistContent(
    "consolidate",
    "consolidate",
    config.schedule.consolidateIntervalHours,
  );

  const defragPlist = plistContent(
    "defrag",
    "defrag",
    config.schedule.defragIntervalHours,
  );

  const consolidatePath = join(LAUNCH_AGENTS, "com.agent-memory.consolidate.plist");
  const defragPath = join(LAUNCH_AGENTS, "com.agent-memory.defrag.plist");

  Bun.write(consolidatePath, consolidatePlist);
  Bun.write(defragPath, defragPlist);

  console.log(`installed:`);
  console.log(`  ${consolidatePath}`);
  console.log(`  ${defragPath}`);
  console.log(`\nto load:`);
  console.log(`  launchctl load ${consolidatePath}`);
  console.log(`  launchctl load ${defragPath}`);
}
