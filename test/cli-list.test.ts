import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { serializeMemoryMarkdown } from "../src/format.js";

let currentTestDir: string;

function createEntry(
  id: string,
  title: string,
  options: {
    tags?: string[];
  } = {},
): void {
  const tags = options.tags ?? [];
  const body = "test body content";
  const content = serializeMemoryMarkdown(title, tags, body);

  const filename = `${title.toLowerCase().replace(/\s+/g, "-")} ${id}.md`;
  const filepath = join(currentTestDir, "topics", filename);
  writeFileSync(filepath, content);
}

function getTestDir(): string {
  return currentTestDir;
}

mock.module("../src/config.js", () => ({
  loadConfig: () => ({
    storage: { root: getTestDir(), autoCommit: true, commitHook: "" },
    llm: { command: "", presets: {} },
    schedule: { consolidateIntervalHours: 2, defragIntervalHours: 24 },
    agentsMd: { targets: [] },
  }),
  expandPath: (p: string) => p,
}));

describe("cli list", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    currentTestDir = join(tmpdir(), `agent-memory-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(currentTestDir, "topics"), { recursive: true });

    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();

    if (existsSync(currentTestDir)) {
      rmSync(currentTestDir, { recursive: true, force: true });
    }
  });

  test("prints 'no entries found' for empty corpus", async () => {
    const { run } = await import("../src/cli/list.js");
    await run([]);

    expect(consoleLogSpy).toHaveBeenCalledWith("no entries found");
  });

  test("lists entries with metadata", async () => {
    createEntry("id__abc123", "Test Entry One", { tags: ["topic__xstate"] });
    createEntry("id__def456", "Test Entry Two");

    const { run } = await import("../src/cli/list.js");
    await run([]);

    const calls = consoleLogSpy.mock.calls.flat();
    const output = calls.join("\n");

    expect(output).toContain("found 2 entries");
    expect(output).toContain("id__abc123");
    expect(output).toContain("id__def456");
    expect(output).toContain("Test Entry One");
    expect(output).toContain("Test Entry Two");
    expect(output).toContain("[topic__xstate]");
  });

  test("filters by --query flag", async () => {
    createEntry("id__xxx111", "XState Patterns");
    createEntry("id__yyy222", "Neverthrow Error Handling");
    createEntry("id__zzz333", "Bun Test Utils");

    const { run } = await import("../src/cli/list.js");
    await run(["--query", "xstate"]);

    const output = consoleLogSpy.mock.calls.flat().join("\n");
    expect(output).toContain("found 1 entries");
    expect(output).toContain("XState Patterns");
    expect(output).not.toContain("Neverthrow");
    expect(output).not.toContain("Bun");
  });

  test("respects --limit flag", async () => {
    const validIds = ["id__abc123", "id__def456", "id__ghi789", "id__jkl012", "id__mno345"];
    for (let i = 0; i < 5; i++) {
      createEntry(validIds[i]!, `Entry ${i}`);
    }

    const topicsDir = join(currentTestDir, "topics");
    const files = readdirSync(topicsDir);
    expect(files.length).toBe(5);

    const config = (await import("../src/config.js"));
    const cfg = config.loadConfig();
    expect(cfg.storage.root).toBe(currentTestDir);

    const { run } = await import("../src/cli/list.js");
    await run(["--limit", "3"]);

    const output = consoleLogSpy.mock.calls.flat().join("\n");
    expect(output).toContain("found 3 entries");
  });
});
