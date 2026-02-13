#!/usr/bin/env bun
/**
 * CLI entrypoint — routes commands to handlers.
 */

import { parseArgs } from "util";

const COMMANDS = [
  "capture",
  "consolidate",
  "defrag",
  "list",
  "read",
  "doctor",
  "generate-agents-md",
  "install-cron",
  "uninstall-cron",
] as const;

type Command = (typeof COMMANDS)[number];

async function main() {
  const { positionals } = parseArgs({
    args: Bun.argv.slice(2),
    strict: false,
    allowPositionals: true,
  });

  const command = positionals[0] as Command | undefined;
  const args = positionals.slice(1);

  if (!command || !COMMANDS.includes(command as Command)) {
    console.error(`usage: memory <command> [options]`);
    console.error(`commands: ${COMMANDS.join(", ")}`);
    process.exit(1);
  }

  try {
    switch (command) {
      case "capture":
        await (await import("./capture.js")).run(args);
        break;
      case "consolidate":
        await (await import("./consolidate.js")).run(args);
        break;
      case "defrag":
        await (await import("./defrag.js")).run(args);
        break;
      case "list":
        await (await import("./list.js")).run(args);
        break;
      case "read":
        await (await import("./read.js")).run(args);
        break;
      case "doctor":
        await (await import("./doctor.js")).run(args);
        break;
      case "generate-agents-md":
        await (await import("./generate-agents-md.js")).run(args);
        break;
      case "install-cron":
        await (await import("./install-cron.js")).run(args);
        break;
      case "uninstall-cron":
        await (await import("./uninstall-cron.js")).run(args);
        break;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

main();
