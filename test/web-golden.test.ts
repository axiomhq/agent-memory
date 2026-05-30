import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { expandPath, loadConfig } from "../src/config.js";
import { createFileMemoryPersistenceAdapter } from "../src/persist/filesystem.js";
import { createMemoryService } from "../src/service.js";
import { handleRequest, type RouterContext } from "../src/web/router.js";

describe("web golden: router integration", () => {
  let ctx: RouterContext;
  const fixtureRoot = expandPath(loadConfig().storage.root);

  beforeAll(() => {
    const adapter = createFileMemoryPersistenceAdapter({ rootDir: fixtureRoot });
    const service = createMemoryService(adapter);
    
    ctx = {
      service,
      rootDir: fixtureRoot,
      readTodoStore: () => ({ version: 1, todos: [] }),
      writeTodoStore: () => {},
      todoStorePath: () => "mock-path"
    };
  });

  test("GET /api/memories routes correctly", async () => {
    const req = new Request("http://127.0.0.1/api/memories?limit=5");
    const res = await handleRequest(req, ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("memories");
  });
});
