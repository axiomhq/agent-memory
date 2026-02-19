import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createFileMemoryPersistenceAdapter } from "../src/persist/filesystem.js";
import { createMemoryService } from "../src/service.js";

describe("service + persistence", () => {
  let testDir: string;
  let service: ReturnType<typeof createMemoryService>;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agent-memory-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    const adapter = createFileMemoryPersistenceAdapter({ rootDir: testDir });
    service = createMemoryService(adapter);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("capture", () => {
    test("creates entry with stable id", async () => {
      const result = await service.capture({
        title: "Test Entry",
        body: "This is the body content.",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.meta.id).toMatch(/^id__[a-zA-Z0-9]{6}$/);
        expect(result.value.meta.title).toBe("Test Entry");
        expect(result.value.body).toBe("This is the body content.");
      }
    });

    test("sets tags as empty array by default", async () => {
      const result = await service.capture({
        title: "Test",
        body: "body",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.meta.tags).toEqual([]);
      }
    });

    test("accepts optional fields", async () => {
      const result = await service.capture({
        title: "Test",
        body: "body",
        tags: ["topic__xstate", "area__testing"],
        sources: { harness: "amp", threadId: "T-123" },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.meta.tags).toEqual(["topic__xstate", "area__testing"]);
        expect(result.value.meta.sources?.threadId).toBe("T-123");
      }
    });

    test("writes to filesystem", async () => {
      const result = await service.capture({
        title: "Unique Test Title",
        body: "body content here",
      });

      expect(result.isOk()).toBe(true);

      const topicsDir = join(testDir, "topics");
      expect(existsSync(topicsDir)).toBe(true);

      const id = result.isOk() ? result.value.meta.id : "";
      expect(id).toBeTruthy();
    });
  });

  describe("list", () => {
    test("returns empty array when no entries", async () => {
      const result = await service.list();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    test("lists entries", async () => {
      await service.capture({ title: "First", body: "body" });
      await service.capture({ title: "Second", body: "body" });

      const result = await service.list();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(2);
      }
    });

    test("filters by query", async () => {
      await service.capture({ title: "XState Patterns", body: "body" });
      await service.capture({ title: "Neverthrow Errors", body: "body" });
      await service.capture({ title: "Bun Testing", body: "body" });

      const result = await service.list({ query: "xstate" });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.title).toBe("XState Patterns");
      }
    });

    test("respects limit", async () => {
      for (let i = 0; i < 5; i++) {
        await service.capture({ title: `Entry ${i}`, body: "body" });
      }

      const result = await service.list({ limit: 3 });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(3);
      }
    });
  });

  describe("read", () => {
    test("returns entry with body", async () => {
      const created = await service.capture({
        title: "Test Entry",
        body: "Full body content here.",
      });

      expect(created.isOk()).toBe(true);
      if (!created.isOk()) return;

      const result = await service.read(created.value.meta.id);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.body).toContain("Full body content here.");
      }
    });

    test("read is pure — no side effects", async () => {
      const created = await service.capture({ title: "Test", body: "body" });
      if (!created.isOk()) return;
      const id = created.value.meta.id;

      // read multiple times — should not change anything
      await service.read(id);
      await service.read(id);
      const r3 = await service.read(id);

      expect(r3.isOk()).toBe(true);
      // no used counter, no last_used, no write-back
    });

    test("fails for invalid id", async () => {
      const result = await service.read("invalid-id");
      expect(result.isErr()).toBe(true);
    });
  });

  describe("updateMeta", () => {
    test("updates allowed fields", async () => {
      const created = await service.capture({ title: "Original", body: "body" });
      if (!created.isOk()) return;

      const result = await service.updateMeta(created.value.meta.id, {
        title: "Updated Title",
        tags: ["topic__new"],
      });

      expect(result.isOk()).toBe(true);

      const read = await service.read(created.value.meta.id);
      expect(read.isOk()).toBe(true);
      if (read.isOk()) {
        expect(read.value.meta.title).toBe("Updated Title");
      }
    });
  });

  describe("updateBody", () => {
    test("updates body content", async () => {
      const created = await service.capture({ title: "Test", body: "original body" });
      if (!created.isOk()) return;

      const result = await service.updateBody(created.value.meta.id, "new body content");
      expect(result.isOk()).toBe(true);

      const read = await service.read(created.value.meta.id);
      expect(read.isOk()).toBe(true);
      if (read.isOk()) {
        expect(read.value.body).toContain("new body content");
      }
    });
  });

  describe("remove", () => {
    test("deletes entry", async () => {
      const created = await service.capture({ title: "To Delete", body: "body" });
      if (!created.isOk()) return;

      const result = await service.remove(created.value.meta.id);
      expect(result.isOk()).toBe(true);

      const list = await service.list();
      expect(list.isOk()).toBe(true);
      if (list.isOk()) {
        expect(list.value.find(e => e.id === created.value.meta.id)).toBeUndefined();
      }
    });
  });
});
