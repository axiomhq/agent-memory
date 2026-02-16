import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  writeAmpJournalEntry,
  fetchAmpThreadHistory,
  buildAmpAfterSessionHook,
} from "../src/adapters/amp.js";

describe("amp adapter", () => {
  let testDir: string;
  let inboxDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agent-memory-test-${Date.now()}`);
    inboxDir = join(testDir, "inbox");
    mkdirSync(inboxDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("writeAmpJournalEntry", () => {
    test("writes valid JSON to inbox with correct structure", async () => {
      const result = await writeAmpJournalEntry("T-123", "/path/to/project", "owner/repo", {
        inboxDir,
      });

      expect(result.success).toBe(true);

      if (result.success && result.path) {
        expect(existsSync(result.path)).toBe(true);

        const content = readFileSync(result.path, "utf-8");
        const parsed = JSON.parse(content);

        expect(parsed.version).toBe("1");
        expect(parsed.harness).toBe("amp");
        expect(parsed.retrieval.method).toBe("amp-thread");
        expect(parsed.retrieval.threadId).toBe("T-123");
        expect(parsed.context.cwd).toBe("/path/to/project");
        expect(parsed.context.repo).toBe("owner/repo");
        expect(parsed.timestamp).toBeDefined();
      }
    });

    test("returns success with path", async () => {
      const result = await writeAmpJournalEntry("T-456", "/another/path", undefined, {
        inboxDir,
      });

      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.path).toMatch(/\.json$/);
    });

    test("handles undefined repo", async () => {
      const result = await writeAmpJournalEntry("T-789", "/path/to/project", undefined, {
        inboxDir,
      });

      expect(result.success).toBe(true);

      if (result.success && result.path) {
        const content = readFileSync(result.path, "utf-8");
        const parsed = JSON.parse(content);
        expect(parsed.context.repo).toBeUndefined();
      }
    });
  });

  describe("fetchAmpThreadHistory", () => {
    test("returns stdout on success", async () => {
      const result = await fetchAmpThreadHistory("T-123");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("buildAmpAfterSessionHook", () => {
    test("returns a callable function", () => {
      const hook = buildAmpAfterSessionHook(inboxDir);
      expect(typeof hook).toBe("function");
    });

    test("hook writes journal entry when called", async () => {
      const hook = buildAmpAfterSessionHook(inboxDir);
      await hook("T-hook-test", "/hook/path", "hook/repo");

      const files = require("fs").readdirSync(inboxDir).filter((f: string) => f.endsWith(".json"));
      expect(files.length).toBe(1);

      const content = readFileSync(join(inboxDir, files[0]), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.retrieval.threadId).toBe("T-hook-test");
    });
  });
});
