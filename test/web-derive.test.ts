import { describe, test, expect } from "bun:test";
import { 
    inferSource, inferTier, inferClasses, inferTopics, countEntries, 
    matchesView, deriveBrowserEntry 
} from "../src/web/derive.js";

describe("web/derive", () => {
    test("inferSource", () => {
        expect(inferSource(["source__chatgpt"], "")).toBe("chatgpt");
        expect(inferSource([], "Source:\nprovider: claude\n")).toBe("claude");
        expect(inferSource([], "")).toBe("unknown");
    });

    test("inferTier", () => {
        expect(inferTier(["tier__curated"])).toBe("curated");
        expect(inferTier(["curated"])).toBe("curated");
        expect(inferTier(["tier__raw_archive"])).toBe("raw_archive");
        expect(inferTier([])).toBe("unknown");
    });

    test("inferClasses", () => {
        expect(inferClasses(["class__curated_candidate"])).toEqual(["curated_candidate"]);
        expect(inferClasses(["curated"])).toEqual(["curated"]);
    });

    test("inferTopics", () => {
        expect(inferTopics(["topic__mcp"])).toEqual(["mcp"]);
        expect(inferTopics(["topic__mcp", "topic__mcp"])).toEqual(["mcp"]);
    });

    test("countEntries", () => {
        const entries = [
            { tags: ["tier__curated"] },
            { tags: ["curated"] },
            { tags: ["class__curated_candidate"] },
            { tags: ["tier__raw_archive"] },
            { tags: ["class__action_required"] }
        ];
        const counts = countEntries(entries);
        expect(counts.curated).toBe(2);
        expect(counts.candidates).toBe(1);
        expect(counts.rawArchive).toBe(1);
        expect(counts.actionRequired).toBe(1);
        expect(counts.total).toBe(5);
    });

    test("matchesView", () => {
        expect(matchesView(["tier__curated"], "curated")).toBe(true);
        expect(matchesView(["class__curated_candidate"], "candidates")).toBe(true);
        expect(matchesView(["tier__raw_archive"], "raw")).toBe(true);
        expect(matchesView(["class__action_required"], "action")).toBe(true);
    });
});
