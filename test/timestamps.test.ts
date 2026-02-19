import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getFileTimestamps } from "../src/timestamps.js";

describe("getFileTimestamps", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `timestamps-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  async function git(...args: string[]) {
    const proc = Bun.spawn(["git", ...args], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test.com",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test.com",
      },
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
    }
    return stdout.trim();
  }

  test("returns timestamps from git history", async () => {
    await git("init");
    const filePath = join(testDir, "entry.md");

    // create file and commit
    writeFileSync(filePath, "# First version\n");
    await git("add", "entry.md");
    await git("commit", "-m", "initial");

    // wait a tick to ensure different timestamp
    await new Promise((r) => setTimeout(r, 1100));

    // modify and commit again
    writeFileSync(filePath, "# Updated version\n");
    await git("add", "entry.md");
    await git("commit", "-m", "update");

    const result = await getFileTimestamps(testDir, "entry.md");

    // createdAt should be earlier than updatedAt
    expect(result.createdAt).toBeLessThan(result.updatedAt);
    // both should be reasonable epoch timestamps (after 2020)
    expect(result.createdAt).toBeGreaterThan(1577836800000);
    expect(result.updatedAt).toBeGreaterThan(1577836800000);
  });

  test("returns fallback for uncommitted file", async () => {
    await git("init");
    const filePath = join(testDir, "uncommitted.md");
    writeFileSync(filePath, "# Uncommitted\n");

    const before = Date.now();
    const result = await getFileTimestamps(testDir, "uncommitted.md");
    const after = Date.now();

    // should return Date.now()-based fallback
    expect(result.createdAt).toBeGreaterThanOrEqual(before);
    expect(result.createdAt).toBeLessThanOrEqual(after);
    expect(result.updatedAt).toBeGreaterThanOrEqual(before);
    expect(result.updatedAt).toBeLessThanOrEqual(after);
  });

  test("returns fallback for nonexistent file", async () => {
    await git("init");
    // need at least one commit for git log to work
    writeFileSync(join(testDir, "dummy.md"), "x");
    await git("add", ".");
    await git("commit", "-m", "init");

    const before = Date.now();
    const result = await getFileTimestamps(testDir, "nonexistent.md");
    const after = Date.now();

    expect(result.createdAt).toBeGreaterThanOrEqual(before);
    expect(result.updatedAt).toBeLessThanOrEqual(after);
  });

  test("returns fallback outside git repo", async () => {
    const before = Date.now();
    const result = await getFileTimestamps(testDir, "anything.md");
    const after = Date.now();

    expect(result.createdAt).toBeGreaterThanOrEqual(before);
    expect(result.updatedAt).toBeLessThanOrEqual(after);
  });

  test("single commit gives same createdAt and updatedAt", async () => {
    await git("init");
    const filePath = join(testDir, "single.md");
    writeFileSync(filePath, "# Single commit\n");
    await git("add", "single.md");
    await git("commit", "-m", "only commit");

    const result = await getFileTimestamps(testDir, "single.md");

    expect(result.createdAt).toBe(result.updatedAt);
  });
});
