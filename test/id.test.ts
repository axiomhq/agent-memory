import { describe, test, expect } from "bun:test";
import { generateId, isValidId, ID_PATTERN } from "../src/id.js";

describe("id", () => {
  describe("generateId", () => {
    test("produces valid id__XXXXXX format", async () => {
      const id = await generateId("test title", 1707849600000);
      expect(id).toMatch(ID_PATTERN);
      expect(id.startsWith("id__")).toBe(true);
      expect(id.length).toBe(10); // "id__" (4 chars) + 6 chars = 10
    });

    test("is deterministic for same input", async () => {
      const id1 = await generateId("test title", 1707849600000);
      const id2 = await generateId("test title", 1707849600000);
      expect(id1).toBe(id2);
    });

    test("differs for different titles", async () => {
      const id1 = await generateId("title one", 1707849600000);
      const id2 = await generateId("title two", 1707849600000);
      expect(id1).not.toBe(id2);
    });

    test("differs for different timestamps", async () => {
      const id1 = await generateId("test title", 1707849600000);
      const id2 = await generateId("test title", 1707849700000);
      expect(id1).not.toBe(id2);
    });

    test("uses base58 alphabet (no ambiguous chars)", async () => {
      const ids = await Promise.all([
        generateId("test 1", Date.now()),
        generateId("test 2", Date.now() + 1),
        generateId("test 3", Date.now() + 2),
      ]);
      
      for (const id of ids) {
        const hash = id.replace("id__", "");
        // base58 excludes: 0, O, I, l
        expect(hash).not.toMatch(/[0OlI]/);
      }
    });
  });

  describe("isValidId", () => {
    test("accepts valid ids", () => {
      expect(isValidId("id__a1b2c3")).toBe(true);
      expect(isValidId("id__ABC123")).toBe(true);
      expect(isValidId("id__xyz789")).toBe(true);
    });

    test("rejects invalid formats", () => {
      expect(isValidId("a1b2c3")).toBe(false); // missing prefix
      expect(isValidId("id_a1b2c3")).toBe(false); // wrong separator
      expect(isValidId("id__a1b2")).toBe(false); // too short
      expect(isValidId("id__a1b2c3d")).toBe(false); // too long
      expect(isValidId("id__a1b2c ")).toBe(false); // contains space
      expect(isValidId("id__a1b2c3!")).toBe(false); // special char
    });
  });
});
