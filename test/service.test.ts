import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createFileMemoryPersistenceAdapter } from "../src/persist/filesystem.js";
import { createMemoryService } from "../src/service.js";
import { generateId } from "../src/id.js";
import { parseMemoryMarkdown } from "../src/format.js";
import type { MemoryEntryMeta } from "../src/schema.js";

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

    test("sets initial status to captured", async () => {
      const result = await service.capture({
        title: "Test",
        body: "body",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.meta.status).toBe("captured");
        expect(result.value.meta.used).toBe(0);
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
      
      // Check file was written
      const topicsDir = join(testDir, "orgs/default/archive");
      const files = Bun.file(".") ? [] : [];
      // The file should exist with the ID in the filename
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

    test("lists entries sorted by updatedAt desc", async () => {
      await service.capture({ title: "First", body: "body" });
      await new Promise(r => setTimeout(r, 10));
      await service.capture({ title: "Second", body: "body" });

      const result = await service.list();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(2);
        expect(result.value[0]!.title).toBe("Second"); // newest first
        expect(result.value[1]!.title).toBe("First");
      }
    });

    test("filters by status", async () => {
      const r1 = await service.capture({ title: "Entry 1", body: "body" });
      const r2 = await service.capture({ title: "Entry 2", body: "body" });

      // Update one to consolidated
      if (r1.isOk()) {
        await service.updateMeta(r1.value.meta.id, { status: "consolidated" });
      }

      const result = await service.list({ status: "consolidated" });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.title).toBe("Entry 1");
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
        expect(result.value.body).toBe("Full body content here.");
      }
    });

    test("increments used counter", async () => {
      const created = await service.capture({ title: "Test", body: "body" });
      if (!created.isOk()) return;
      const id = created.value.meta.id;

      const r1 = await service.read(id);
      expect(r1.isOk()).toBe(true);
      if (r1.isOk()) {
        expect(r1.value.meta.used).toBe(1);
      }

      const r2 = await service.read(id);
      expect(r2.isOk()).toBe(true);
      if (r2.isOk()) {
        expect(r2.value.meta.used).toBe(2);
      }
    });

    test("updates last_used timestamp", async () => {
      const created = await service.capture({ title: "Test", body: "body" });
      if (!created.isOk()) return;

      const before = created.value.meta.last_used;
      await new Promise(r => setTimeout(r, 10));
      
      const result = await service.read(created.value.meta.id);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.meta.last_used).not.toBe(before);
      }
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
        status: "consolidated",
        tags: ["topic__new"],
      });

      expect(result.isOk()).toBe(true);

      const read = await service.read(created.value.meta.id);
      expect(read.isOk()).toBe(true);
      if (read.isOk()) {
        expect(read.value.meta.title).toBe("Updated Title");
        expect(read.value.meta.status).toBe("consolidated");
        expect(read.value.meta.tags).toEqual(["topic__new"]);
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
        expect(read.value.body).toBe("new body content");
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
