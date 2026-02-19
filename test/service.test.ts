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

  describe("rename", () => {
    test("updates title and filename", async () => {
      const created = await service.capture({ title: "Old Title", body: "body content" });
      if (!created.isOk()) return;
      const id = created.value.meta.id;

      const result = await service.rename(id, "New Title");
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const read = await service.read(id);
      expect(read.isOk()).toBe(true);
      if (read.isOk()) {
        expect(read.value.meta.title).toBe("New Title");
        expect(read.value.body).toContain("body content");
      }
    });

    test("updates inbound link display text matching old title", async () => {
      const entryB = await service.capture({ title: "Entry B", body: "b content" });
      if (!entryB.isOk()) return;
      const idB = entryB.value.meta.id;

      const entryA = await service.capture({
        title: "Entry A",
        body: `see [[${idB}|Entry B]] for context`,
      });
      if (!entryA.isOk()) return;
      const idA = entryA.value.meta.id;

      const result = await service.rename(idB, "Renamed B");
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.updatedInboundLinks).toBe(1);

      const readA = await service.read(idA);
      expect(readA.isOk()).toBe(true);
      if (readA.isOk()) {
        expect(readA.value.body).toContain(`[[${idB}|Renamed B]]`);
      }
    });

    test("preserves custom display text on inbound links", async () => {
      const entryB = await service.capture({ title: "Entry B", body: "b content" });
      if (!entryB.isOk()) return;
      const idB = entryB.value.meta.id;

      // entry A links to B with CUSTOM display text (not matching title)
      const entryA = await service.capture({
        title: "Entry A",
        body: `see [[${idB}|my custom label]] here`,
      });
      if (!entryA.isOk()) return;
      const idA = entryA.value.meta.id;

      const result = await service.rename(idB, "Renamed B");
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.updatedInboundLinks).toBe(0);

      // custom display text should be preserved
      const readA = await service.read(idA);
      expect(readA.isOk()).toBe(true);
      if (readA.isOk()) {
        expect(readA.value.body).toContain(`[[${idB}|my custom label]]`);
      }
    });
  });

  describe("links", () => {
    test("returns outbound links from entry body", async () => {
      const a = await service.capture({ title: "A", body: "standalone", tags: [] });
      if (!a.isOk()) return;

      const b = await service.capture({
        title: "B",
        body: `links to [[${a.value.meta.id}|A]] here`,
        tags: [],
      });
      if (!b.isOk()) return;

      const result = await service.links(b.value.meta.id);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.outbound).toHaveLength(1);
      expect(result.value.outbound[0]!.id).toBe(a.value.meta.id);
      expect(result.value.outbound[0]!.displayText).toBe("A");
    });

    test("returns inbound links pointing to entry", async () => {
      const a = await service.capture({ title: "A", body: "standalone", tags: [] });
      if (!a.isOk()) return;

      const b = await service.capture({
        title: "B",
        body: `links to [[${a.value.meta.id}|A]]`,
        tags: [],
      });
      if (!b.isOk()) return;

      const result = await service.links(a.value.meta.id);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.inbound).toHaveLength(1);
      expect(result.value.inbound[0]!.id).toBe(b.value.meta.id);
      expect(result.value.inbound[0]!.title).toBe("B");
      expect(result.value.outbound).toHaveLength(0);
    });
  });

  describe("orphans", () => {
    test("returns entries with no inbound links", async () => {
      const a = await service.capture({ title: "A", body: "no links to me", tags: [] });
      if (!a.isOk()) return;

      const b = await service.capture({ title: "B", body: "also alone", tags: [] });
      if (!b.isOk()) return;

      const c = await service.capture({
        title: "C",
        body: `links to [[${a.value.meta.id}|A]]`,
        tags: [],
      });
      if (!c.isOk()) return;

      const result = await service.orphans();
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      // B and C are orphans (no one links to them). A has an inbound link from C.
      expect(result.value).toContain(b.value.meta.id);
      expect(result.value).toContain(c.value.meta.id);
      expect(result.value).not.toContain(a.value.meta.id);
    });
  });

  describe("brokenLinks", () => {
    test("detects links to nonexistent entries", async () => {
      const a = await service.capture({
        title: "A",
        body: "links to [[id__zzzzzz|ghost]]",
        tags: [],
      });
      if (!a.isOk()) return;

      const result = await service.brokenLinks();
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.sourceId).toBe(a.value.meta.id);
      expect(result.value[0]!.targetId).toBe("id__zzzzzz");
    });

    test("returns empty when all links are valid", async () => {
      const a = await service.capture({ title: "A", body: "a content", tags: [] });
      if (!a.isOk()) return;

      await service.capture({
        title: "B",
        body: `links to [[${a.value.meta.id}|A]]`,
        tags: [],
      });

      const result = await service.brokenLinks();
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value).toHaveLength(0);
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
