import { describe, test, expect, mock } from "bun:test";
import { ok } from "neverthrow";
import type { MemoryService } from "../src/service.js";
import { handleMemoriesGet } from "../src/web/api/memories.js";

describe("web/api/memories", () => {
    test("handleMemoriesGet filters and pagination", async () => {
        const mockService = {
            list: mock(async () => ok([
                { id: "1", title: "m1", tags: ["tier__curated"], org: "default" },
                { id: "2", title: "m2", tags: ["tier__raw_archive"], org: "default" },
            ])),
            read: mock(async (id) => ok({ 
                meta: { id, title: id === "1" ? "m1" : "m2", tags: id === "1" ? ["tier__curated"] : ["tier__raw_archive"], org: "default" }, 
                body: "body" 
            }))
        } as unknown as MemoryService;

        const result = await handleMemoriesGet({
            service: mockService,
            limit: 10,
            offset: 0
        });

        expect(result.total).toBe(2);
        expect(result.memories.length).toBe(2);
    });
});
