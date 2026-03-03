import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  writePiJournalEntry,
  fetchPiSessionHistory,
  buildPiAfterSessionHook,
} from "../src/adapters/pi.js";

describe("pi adapter", () => {
  let testDir: string;
  let inboxDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agent-memory-pi-test-${Date.now()}`);
    inboxDir = join(testDir, "inbox");
    mkdirSync(inboxDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("writePiJournalEntry", () => {
    test("writes valid JSON to inbox with correct structure", async () => {
      const result = await writePiJournalEntry(
        "/tmp/sessions/abc.jsonl",
        "/path/to/project",
        "owner/repo",
        { inboxDir },
      );

      expect(result.success).toBe(true);

      if (result.success && result.path) {
        expect(existsSync(result.path)).toBe(true);

        const content = readFileSync(result.path, "utf-8");
        const parsed = JSON.parse(content);

        expect(parsed.version).toBe("1");
        expect(parsed.harness).toBe("pi");
        expect(parsed.retrieval.method).toBe("pi-session");
        expect(parsed.retrieval.sessionPath).toBe("/tmp/sessions/abc.jsonl");
        expect(parsed.context.cwd).toBe("/path/to/project");
        expect(parsed.context.repo).toBe("owner/repo");
        expect(parsed.timestamp).toBeDefined();
      }
    });

    test("returns success with path", async () => {
      const result = await writePiJournalEntry(
        "/tmp/sessions/def.jsonl",
        "/another/path",
        undefined,
        { inboxDir },
      );

      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.path).toMatch(/\.json$/);
    });

    test("handles undefined repo", async () => {
      const result = await writePiJournalEntry(
        "/tmp/sessions/ghi.jsonl",
        "/path/to/project",
        undefined,
        { inboxDir },
      );

      expect(result.success).toBe(true);

      if (result.success && result.path) {
        const content = readFileSync(result.path, "utf-8");
        const parsed = JSON.parse(content);
        expect(parsed.context.repo).toBeUndefined();
      }
    });
  });

  describe("fetchPiSessionHistory", () => {
    test("extracts assistant string content from .jsonl", async () => {
      const sessionPath = join(testDir, "session.jsonl");
      const lines = [
        JSON.stringify({ role: "user", content: "hello" }),
        JSON.stringify({ role: "assistant", content: "hi there" }),
        JSON.stringify({ role: "user", content: "help me" }),
        JSON.stringify({ role: "assistant", content: "sure thing" }),
      ];
      writeFileSync(sessionPath, lines.join("\n"));

      const result = await fetchPiSessionHistory(sessionPath);
      expect(result).toBe("hi there\n\nsure thing");
    });

    test("extracts assistant content from typed blocks", async () => {
      const sessionPath = join(testDir, "session.jsonl");
      const lines = [
        JSON.stringify({
          role: "assistant",
          content: [
            { type: "text", text: "first block" },
            { type: "tool_use", id: "t1" },
            { type: "text", text: "second block" },
          ],
        }),
      ];
      writeFileSync(sessionPath, lines.join("\n"));

      const result = await fetchPiSessionHistory(sessionPath);
      expect(result).toBe("first block\n\nsecond block");
    });

    test("throws on missing file", async () => {
      await expect(fetchPiSessionHistory("/nonexistent/path.jsonl")).rejects.toThrow(
        "pi session file not found",
      );
    });

    test("throws when no assistant content found", async () => {
      const sessionPath = join(testDir, "empty-session.jsonl");
      writeFileSync(sessionPath, JSON.stringify({ role: "user", content: "hello" }));

      await expect(fetchPiSessionHistory(sessionPath)).rejects.toThrow(
        "no assistant content found",
      );
    });

    test("skips malformed lines", async () => {
      const sessionPath = join(testDir, "messy.jsonl");
      const lines = [
        "not json at all",
        JSON.stringify({ role: "assistant", content: "valid line" }),
        "{broken json",
      ];
      writeFileSync(sessionPath, lines.join("\n"));

      const result = await fetchPiSessionHistory(sessionPath);
      expect(result).toBe("valid line");
    });
  });

  describe("buildPiAfterSessionHook", () => {
    test("returns a callable function", () => {
      const hook = buildPiAfterSessionHook(inboxDir);
      expect(typeof hook).toBe("function");
    });

    test("hook writes journal entry when called", async () => {
      const hook = buildPiAfterSessionHook(inboxDir);
      await hook("/tmp/sessions/hook.jsonl", "/hook/path", "hook/repo");

      const files = require("fs").readdirSync(inboxDir).filter((f: string) => f.endsWith(".json"));
      expect(files.length).toBe(1);

      const content = readFileSync(join(inboxDir, files[0]), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.retrieval.sessionPath).toBe("/tmp/sessions/hook.jsonl");
    });
  });
});
