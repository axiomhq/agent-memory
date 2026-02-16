import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { run } from "../src/cli/capture.js";
import type { JournalQueueEntry } from "../src/schema.js";

describe("cli capture", () => {
  let testDir: string;
  let inboxDir: string;
  let originalCwd: string;
  let exitMock: ReturnType<typeof spyOn>;
  let consoleErrorMock: ReturnType<typeof spyOn>;
  let consoleLogMock: ReturnType<typeof spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `agent-memory-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    inboxDir = join(testDir, "inbox");
    mkdirSync(inboxDir, { recursive: true });

    const configContent = JSON.stringify({ storage: { root: testDir } });
    writeFileSync(join(testDir, "memory.config.json"), configContent);

    originalCwd = process.cwd();
    process.chdir(testDir);

    exitMock = spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    consoleErrorMock = spyOn(console, "error").mockImplementation(() => {});
    consoleLogMock = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    exitMock.mockRestore();
    consoleErrorMock.mockRestore();
    consoleLogMock.mockRestore();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  const readInboxEntry = (): { path: string; entry: JournalQueueEntry } | null => {
    const files = readdirSync(inboxDir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) return null;
    const filePath = join(inboxDir, files[0]!);
    const content = readFileSync(filePath, "utf-8");
    return { path: filePath, entry: JSON.parse(content) };
  };

  describe("required flags", () => {
    test("exits with code 1 if --title missing", async () => {
      try {
        await run(["--body", "test body"]);
      } catch (e) {
        expect((e as Error).message).toBe("process.exit(1)");
      }
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(consoleErrorMock).toHaveBeenCalledWith(expect.stringContaining("usage:"));
    });

    test("exits with code 1 if --body missing", async () => {
      try {
        await run(["--title", "test title"]);
      } catch (e) {
        expect((e as Error).message).toBe("process.exit(1)");
      }
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(consoleErrorMock).toHaveBeenCalledWith(expect.stringContaining("usage:"));
    });

    test("exits with code 1 if both --title and --body missing", async () => {
      try {
        await run([]);
      } catch (e) {
        expect((e as Error).message).toBe("process.exit(1)");
      }
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe("successful capture", () => {
    test("writes valid JSON to inbox with required flags", async () => {
      await run(["--title", "my title", "--body", "my body"]);

      const result = readInboxEntry();
      expect(result).not.toBeNull();
      expect(result!.entry.version).toBe("1");
      expect(result!.entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result!.entry.harness).toBe("manual");
      expect(result!.entry.retrieval.method).toBe("file");
      expect(result!.entry.context.cwd).toBe(testDir.replace(/^\/var\//, "/private/var/"));
    });

    test("prints captured filepath on success", async () => {
      await run(["--title", "t", "--body", "b"]);

      expect(consoleLogMock).toHaveBeenCalledWith(expect.stringMatching(/^captured: .*\.json$/));
    });

    test("creates inbox directory if missing", async () => {
      rmSync(inboxDir, { recursive: true, force: true });
      expect(existsSync(inboxDir)).toBe(false);

      await run(["--title", "t", "--body", "b"]);

      expect(existsSync(inboxDir)).toBe(true);
    });
  });

  describe("optional flags", () => {
    test("--harness sets harness field", async () => {
      await run(["--title", "t", "--body", "b", "--harness", "amp"]);

      const result = readInboxEntry();
      expect(result!.entry.harness).toBe("amp");
    });

    test("--thread-id sets retrieval method to amp-thread", async () => {
      await run(["--title", "t", "--body", "b", "--thread-id", "T-12345"]);

      const result = readInboxEntry();
      expect(result!.entry.retrieval.method).toBe("amp-thread");
      expect(result!.entry.retrieval.threadId).toBe("T-12345");
    });

    test("--thread-id with --harness amp", async () => {
      await run(["--title", "t", "--body", "b", "--harness", "amp", "--thread-id", "T-999"]);

      const result = readInboxEntry();
      expect(result!.entry.harness).toBe("amp");
      expect(result!.entry.retrieval.threadId).toBe("T-999");
    });

    test("--cwd sets context.cwd", async () => {
      await run(["--title", "t", "--body", "b", "--cwd", "/custom/path"]);

      const result = readInboxEntry();
      expect(result!.entry.context.cwd).toBe("/custom/path");
    });

    test("--repo sets context.repo", async () => {
      await run(["--title", "t", "--body", "b", "--repo", "owner/repo"]);

      const result = readInboxEntry();
      expect(result!.entry.context.repo).toBe("owner/repo");
    });

    test("--tags is accepted (parsed but not stored in entry)", async () => {
      await run(["--title", "t", "--body", "b", "--tags", "tag1", "--tags", "tag2"]);

      const result = readInboxEntry();
      expect(result).not.toBeNull();
    });

    test("short flags: -t for title, -b for body, -g for tags", async () => {
      await run(["-t", "short title", "-b", "short body", "-g", "tag1", "-g", "tag2"]);

      const result = readInboxEntry();
      expect(result).not.toBeNull();
      expect(consoleLogMock).toHaveBeenCalledWith(expect.stringMatching(/^captured:/));
    });
  });

  describe("schema validation", () => {
    test("entry passes JournalQueueEntrySchema", async () => {
      await run([
        "--title",
        "t",
        "--body",
        "b",
        "--harness",
        "amp",
        "--thread-id",
        "T-123",
        "--cwd",
        "/path",
        "--repo",
        "owner/repo",
      ]);

      const result = readInboxEntry();
      const entry = result!.entry;

      expect(entry.version).toBe("1");
      expect(typeof entry.timestamp).toBe("string");
      expect(["amp", "cursor", "codex", "manual"]).toContain(entry.harness);
      expect(["amp-thread", "cursor-session", "file"]).toContain(entry.retrieval.method);
      expect(typeof entry.context.cwd).toBe("string");
    });
  });
});