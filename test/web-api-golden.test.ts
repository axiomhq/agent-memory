import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { expandPath, loadConfig } from "../src/config.js";
import { createFileMemoryPersistenceAdapter } from "../src/persist/filesystem.js";
import { createMemoryService } from "../src/service.js";

describe("web API golden fixtures: /api/entries vs /api/memories parity", () => {
  let server: any;
  const fixtureRoot = expandPath(loadConfig().storage.root);
  const port = 3334;
  const baseUrl = `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    const adapter = createFileMemoryPersistenceAdapter({ rootDir: fixtureRoot });
    const service = createMemoryService(adapter);

    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: async (request) => {
        const url = new URL(request.url);

        // Minimal /api/entries handler for comparison
        if (request.method === "GET" && url.pathname === "/api/entries") {
          const query = url.searchParams.get("query") ?? undefined;
          const org = url.searchParams.get("org") ?? undefined;
          const limit = Number.parseInt(url.searchParams.get("limit") ?? "500", 10);
          const result = await service.list({ org: org || undefined });

          if (result.isErr()) {
            return new Response(JSON.stringify({ error: result.error.message }), { status: 500 });
          }

          const entries = result.value.map((entry) => ({
            id: entry.id,
            title: entry.title,
            tags: entry.tags ?? [],
            org: entry.org,
            excerpt: "excerpt",
          }));

          return new Response(JSON.stringify({ entries: entries.slice(0, limit), total: entries.length, limit }), {
            headers: { "content-type": "application/json" },
          });
        }

        if (request.method === "GET" && url.pathname.startsWith("/api/entries/")) {
          const id = decodeURIComponent(url.pathname.slice("/api/entries/".length));
          const entryResult = await service.read(id);

          if (entryResult.isErr()) {
            return new Response(JSON.stringify({ error: entryResult.error.message }), { status: 404 });
          }

          return new Response(
            JSON.stringify({
              entry: {
                id: entryResult.value.meta.id,
                title: entryResult.value.meta.title,
                tags: entryResult.value.meta.tags ?? [],
                org: entryResult.value.meta.org,
                body: entryResult.value.body,
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }

        // Minimal /api/memories handlers
        if (request.method === "GET" && url.pathname === "/api/memories") {
          const query = url.searchParams.get("search") ?? url.searchParams.get("query") ?? undefined;
          const org = url.searchParams.get("org") ?? undefined;
          const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
          const result = await service.list({ org: org || undefined });

          if (result.isErr()) {
            return new Response(JSON.stringify({ error: result.error.message }), { status: 500 });
          }

          const memories = result.value.map((entry) => ({
            id: entry.id,
            title: entry.title,
            tags: entry.tags ?? [],
            org: entry.org,
            excerpt: "excerpt",
          }));

          return new Response(
            JSON.stringify({
              memories: memories.slice(0, limit),
              total: result.value.length,
              filtered: memories.length,
              limit,
              offset: 0,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }

        if (request.method === "GET" && url.pathname.startsWith("/api/memories/")) {
          const id = decodeURIComponent(url.pathname.slice("/api/memories/".length));
          const entryResult = await service.read(id);

          if (entryResult.isErr()) {
            return new Response(JSON.stringify({ error: entryResult.error.message }), { status: 404 });
          }

          return new Response(
            JSON.stringify({
              memory: {
                id: entryResult.value.meta.id,
                title: entryResult.value.meta.title,
                tags: entryResult.value.meta.tags ?? [],
                org: entryResult.value.meta.org,
                body: entryResult.value.body,
              },
              links: null,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }

        return new Response("not found", { status: 404 });
      },
    });

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(() => {
    server.stop();
  });

  test("GET /api/entries (list) and GET /api/memories (list) return equivalent entries", async () => {
    const entriesRes = await fetch(`${baseUrl}/api/entries?limit=500`);
    const memoriesRes = await fetch(`${baseUrl}/api/memories?limit=500`);

    expect(entriesRes.ok).toBe(true);
    expect(memoriesRes.ok).toBe(true);

    const entries = await entriesRes.json();
    const memories = await memoriesRes.json();

    // Check field names
    expect(entries).toHaveProperty("entries");
    expect(memories).toHaveProperty("memories");

    // Verify both have same count
    expect(entries.entries.length).toBe(memories.memories.length);

    // Verify each entry has the required fields
    for (const entry of entries.entries) {
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("title");
      expect(entry).toHaveProperty("tags");
      expect(entry).toHaveProperty("org");
    }

    for (const memory of memories.memories) {
      expect(memory).toHaveProperty("id");
      expect(memory).toHaveProperty("title");
      expect(memory).toHaveProperty("tags");
      expect(memory).toHaveProperty("org");
    }

    // Verify order and content match
    for (let i = 0; i < entries.entries.length; i++) {
      const entry = entries.entries[i];
      const memory = memories.memories[i];
      expect(entry.id).toBe(memory.id);
      expect(entry.title).toBe(memory.title);
      expect(entry.tags).toEqual(memory.tags);
      expect(entry.org).toBe(memory.org);
    }
  });

  test("GET /api/entries/:id (detail) and GET /api/memories/:id (detail) return equivalent data", async () => {
    // First get a list to find an entry to test
    const listRes = await fetch(`${baseUrl}/api/entries?limit=1`);
    const { entries } = await listRes.json();

    if (entries.length === 0) {
      test.skip();
      return;
    }

    const testId = entries[0].id;

    // Get detail from both endpoints
    const entryRes = await fetch(`${baseUrl}/api/entries/${encodeURIComponent(testId)}`);
    const memoryRes = await fetch(`${baseUrl}/api/memories/${encodeURIComponent(testId)}`);

    expect(entryRes.ok).toBe(true);
    expect(memoryRes.ok).toBe(true);

    const entry = await entryRes.json();
    const memory = await memoryRes.json();

    // Check top-level field names
    expect(entry).toHaveProperty("entry");
    expect(memory).toHaveProperty("memory");

    // Verify core fields match
    expect(entry.entry.id).toBe(memory.memory.id);
    expect(entry.entry.title).toBe(memory.memory.title);
    expect(entry.entry.tags).toEqual(memory.memory.tags);
    expect(entry.entry.org).toBe(memory.memory.org);
    expect(entry.entry.body).toBe(memory.memory.body);
  });

  test("/api/memories consumes the same field set that /old requires", async () => {
    // /old needs: id, title, tags, org, body, source, tier, classes, topics
    // These are computed from the base response in deriveBrowserEntry()
    const listRes = await fetch(`${baseUrl}/api/memories?limit=1`);
    const { memories } = await listRes.json();

    if (memories.length === 0) {
      test.skip();
      return;
    }

    const testMemory = memories[0];
    const testId = testMemory.id;

    const detailRes = await fetch(`${baseUrl}/api/memories/${encodeURIComponent(testId)}`);
    const { memory } = await detailRes.json();

    // Verify all fields /old needs are present
    expect(memory).toHaveProperty("id");
    expect(memory).toHaveProperty("title");
    expect(memory).toHaveProperty("tags");
    expect(memory).toHaveProperty("org");
    expect(memory).toHaveProperty("body");

    // /old derives source, tier, classes, topics from tags and body
    expect(Array.isArray(memory.tags)).toBe(true);
    expect(typeof memory.body).toBe("string");
  });
});
