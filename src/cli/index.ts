#!/usr/bin/env bun
/**
 * CLI entrypoint — routes commands to handlers.
 */

const COMMANDS = [
  "capture",
  "consolidate",
  "defrag",
  "list",
  "read",
  "doctor",
  "mcp-server",
  "web",
  "generate-agents-md",
  "install-cron",
  "uninstall-cron",
] as const;

type Command = (typeof COMMANDS)[number];

async function main() {
  const argv = Bun.argv.slice(2);
  const command = argv[0] as Command | undefined;
  const args = argv.slice(1);

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
      case "mcp-server":
        await (await import("./mcp-server.js")).run(args);
        break;
      case "web":
        await (await import("./web.js")).run(args);
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
