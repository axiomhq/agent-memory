import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { checkHealth } from "../src/cli/doctor.js";

describe("cli doctor", () => {
  let testDir: string;
  let topicsDir: string;
  let archiveDir: string;
  let inboxDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agent-memory-doctor-test-${Date.now()}`);
    topicsDir = join(testDir, "topics");
    archiveDir = join(testDir, "archive");
    inboxDir = join(testDir, "inbox");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("checkHealth", () => {
    test("returns empty result for non-existent root", async () => {
      const result = await checkHealth("/nonexistent/path");

      expect(result.entries).toBe(0);
      expect(result.pendingQueue).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test("returns empty result for empty root directory", async () => {
      mkdirSync(testDir, { recursive: true });

      const result = await checkHealth(testDir);

      expect(result.entries).toBe(0);
      expect(result.pendingQueue).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test("counts entries with valid id in filename", async () => {
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(
        join(topicsDir, "some-topic -- tag__x id__ABC123.md"),
        "---\nmeta:\n  id: id__ABC123\n---\ncontent"
      );

      const result = await checkHealth(testDir);

      expect(result.entries).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test("detects file missing id in filename (warning)", async () => {
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(
        join(topicsDir, "some-topic -- tag__x.md"),
        "---\nmeta:\n  id: id__ABC123\n---\ncontent"
      );

      const result = await checkHealth(testDir);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.message).toContain("file missing id in filename");
      expect(result.warnings[0]!.message).toContain("some-topic -- tag__x.md");
    });

    test("detects invalid id format in filename (error)", async () => {
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(
        join(topicsDir, "topic -- tag__x id__ABC0EF.md"),
        "---\nmeta:\n  id: id__ABC0EF\n---\ncontent"
      );

      const result = await checkHealth(testDir);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.message).toContain("invalid id format");
      expect(result.errors[0]!.message).toContain("id__ABC0EF");
    });

    test("valid id format uses base58 characters", async () => {
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(
        join(topicsDir, "topic id__123abc.md"),
        "---\nmeta:\n  id: id__123abc\n---\ncontent"
      );

      const result = await checkHealth(testDir);

      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.entries).toBe(1);
    });

    test("id with zero character is invalid (not in base58)", async () => {
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(
        join(topicsDir, "topic id__abc012.md"),
        "---\nmeta:\n  id: id__abc012\n---\ncontent"
      );

      const result = await checkHealth(testDir);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.message).toContain("invalid id format");
    });

    test("id with capital O is invalid (not in base58)", async () => {
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(
        join(topicsDir, "topic id__ABCOEF.md"),
        "---\nmeta:\n  id: id__ABCOEF\n---\ncontent"
      );

      const result = await checkHealth(testDir);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.message).toContain("invalid id format");
    });

    test("id with capital I is invalid (not in base58)", async () => {
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(
        join(topicsDir, "topic id__ABCIEF.md"),
        "---\nmeta:\n  id: id__ABCIEF\n---\ncontent"
      );

      const result = await checkHealth(testDir);

      expect(result.errors).toHaveLength(1);
    });

    test("id with lowercase l is invalid (not in base58)", async () => {
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(
        join(topicsDir, "topic id__abcdel.md"),
        "---\nmeta:\n  id: id__abcdel\n---\ncontent"
      );

      const result = await checkHealth(testDir);

      expect(result.errors).toHaveLength(1);
    });

    test("counts entries from both topics and archive", async () => {
      mkdirSync(topicsDir, { recursive: true });
      mkdirSync(archiveDir, { recursive: true });

      writeFileSync(join(topicsDir, "topic1 id__111aaa.md"), "content1");
      writeFileSync(join(topicsDir, "topic2 id__222bbb.md"), "content2");
      writeFileSync(join(archiveDir, "archived id__333ccc.md"), "content3");

      const result = await checkHealth(testDir);

      expect(result.entries).toBe(3);
    });

    test("ignores non-md files", async () => {
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(join(topicsDir, "topic id__abc123.md"), "content");
      writeFileSync(join(topicsDir, "readme.txt"), "text");
      writeFileSync(join(topicsDir, "data.json"), "{}");

      const result = await checkHealth(testDir);

      expect(result.entries).toBe(1);
    });

    test("counts pending queue items from inbox", async () => {
      mkdirSync(testDir, { recursive: true });
      mkdirSync(inboxDir, { recursive: true });

      writeFileSync(join(inboxDir, "entry1.json"), "{}");
      writeFileSync(join(inboxDir, "entry2.json"), "{}");
      writeFileSync(join(inboxDir, ".hidden.json"), "{}");

      const result = await checkHealth(testDir);

      expect(result.pendingQueue).toBe(2);
    });

    test("ignores non-json files in inbox", async () => {
      mkdirSync(testDir, { recursive: true });
      mkdirSync(inboxDir, { recursive: true });

      writeFileSync(join(inboxDir, "entry.json"), "{}");
      writeFileSync(join(inboxDir, "readme.txt"), "text");

      const result = await checkHealth(testDir);

      expect(result.pendingQueue).toBe(1);
    });

    test("handles missing topics and archive directories gracefully", async () => {
      mkdirSync(testDir, { recursive: true });

      const result = await checkHealth(testDir);

      expect(result.entries).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    test("handles missing inbox directory gracefully", async () => {
      mkdirSync(testDir, { recursive: true });

      const result = await checkHealth(testDir);

      expect(result.pendingQueue).toBe(0);
    });

    test("multiple warnings and errors are all reported", async () => {
      mkdirSync(topicsDir, { recursive: true });

      writeFileSync(join(topicsDir, "no-id-1.md"), "content");
      writeFileSync(join(topicsDir, "no-id-2.md"), "content");
      writeFileSync(join(topicsDir, "bad-id id__0OOO00.md"), "content");

      const result = await checkHealth(testDir);

      expect(result.warnings).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
    });

    test("healthy system returns all zeros", async () => {
      mkdirSync(topicsDir, { recursive: true });
      mkdirSync(archiveDir, { recursive: true });
      mkdirSync(inboxDir, { recursive: true });

      writeFileSync(join(topicsDir, "valid-entry -- tag__test id__abc123.md"), "content");
      writeFileSync(join(archiveDir, "archived-entry id__def456.md"), "content");

      const result = await checkHealth(testDir);

      expect(result.entries).toBe(2);
      expect(result.pendingQueue).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
