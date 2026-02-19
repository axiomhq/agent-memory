import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  generateAgentsMdSection,
  wrapInSection,
  replaceAgentsMdSection,
  assignTiers,
} from "../src/agents-md/generator.js";
import type { MemoryEntryMeta } from "../src/schema.js";

const createMeta = (overrides: Partial<MemoryEntryMeta> = {}): MemoryEntryMeta => ({
  id: "id__abc123",
  title: "Test Entry",
  tags: [],
  createdAt: 1707849600000,
  updatedAt: 1707849600000,
  org: "default",
  ...overrides,
});

describe("agents-md generator", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agent-memory-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("generateAgentsMdSection", () => {
    test("shows 'no hot-tier entries yet' with empty entries", () => {
      const result = generateAgentsMdSection([], []);

      expect(result).toContain("## memory");
      expect(result).toContain("_no hot-tier entries yet._");
      expect(result).toContain("browse all: `memory list`");
    });

    test("includes title and body with hot entries", () => {
      const hotEntries = [
        {
          meta: createMeta({ id: "id__hot1", title: "Important Pattern" }),
          body: "Always use Result types for error handling.",
        },
      ];

      const result = generateAgentsMdSection(hotEntries, []);

      expect(result).toContain("### Important Pattern");
      expect(result).toContain("Always use Result types for error handling.");
      expect(result).not.toContain("_no hot-tier entries yet._");
    });

    test("shows list with ids and titles for warm entries", () => {
      const warmEntries = [
        { meta: createMeta({ id: "id__warm1", title: "Pattern A" }), path: "/path/a.md" },
        { meta: createMeta({ id: "id__warm2", title: "Pattern B", tags: ["topic__x"] }), path: "/path/b.md" },
      ];

      const result = generateAgentsMdSection([], warmEntries);

      expect(result).toContain("### warm-tier");
      expect(result).toContain("`id__warm1`: Pattern A");
      expect(result).toContain("`id__warm2`: Pattern B");
      expect(result).toContain("[topic__x]");
    });

    test("includes both hot and warm entries", () => {
      const hotEntries = [
        {
          meta: createMeta({ id: "id__hot1", title: "Hot Topic" }),
          body: "Hot content here.",
        },
      ];
      const warmEntries = [
        { meta: createMeta({ id: "id__warm1", title: "Warm Topic" }), path: "/path/w.md" },
      ];

      const result = generateAgentsMdSection(hotEntries, warmEntries);

      expect(result).toContain("### Hot Topic");
      expect(result).toContain("Hot content here.");
      expect(result).toContain("### warm-tier");
      expect(result).toContain("`id__warm1`: Warm Topic");
    });
  });

  describe("wrapInSection", () => {
    test("adds sentinel comments", () => {
      const content = "## memory\n\nsome content";
      const result = wrapInSection(content);

      expect(result).toContain("<!-- agent-memory:start -->");
      expect(result).toContain("<!-- agent-memory:end -->");
      expect(result).toContain("some content");
    });

    test("wraps content between sentinels", () => {
      const result = wrapInSection("test content");
      const lines = result.split("\n");

      expect(lines[0]).toBe("<!-- agent-memory:start -->");
      expect(lines[lines.length - 1]).toBe("<!-- agent-memory:end -->");
    });
  });

  describe("replaceAgentsMdSection", () => {
    test("creates new file if doesn't exist", () => {
      const targetPath = join(testDir, "AGENTS.md");
      const section = "## memory\n\ntest content";

      replaceAgentsMdSection(targetPath, section);

      expect(existsSync(targetPath)).toBe(true);
      const content = readFileSync(targetPath, "utf-8");
      expect(content).toContain("<!-- agent-memory:start -->");
      expect(content).toContain("test content");
      expect(content).toContain("<!-- agent-memory:end -->");
    });

    test("replaces existing section between sentinels", () => {
      const targetPath = join(testDir, "AGENTS.md");
      const original = `# Project

<!-- agent-memory:start -->
## memory

old content
<!-- agent-memory:end -->

## Other Section
`;
      writeFileSync(targetPath, original, "utf-8");

      replaceAgentsMdSection(targetPath, "## memory\n\nnew content");

      const content = readFileSync(targetPath, "utf-8");
      expect(content).toContain("new content");
      expect(content).not.toContain("old content");
      expect(content).toContain("## Other Section");
    });

    test("appends if no sentinels found", () => {
      const targetPath = join(testDir, "AGENTS.md");
      const original = `# Project

Some existing content without sentinels.
`;
      writeFileSync(targetPath, original, "utf-8");

      replaceAgentsMdSection(targetPath, "## memory\n\nappended content");

      const content = readFileSync(targetPath, "utf-8");
      expect(content).toContain("Some existing content");
      expect(content).toContain("<!-- agent-memory:start -->");
      expect(content).toContain("appended content");
    });

    test("preserves content before and after sentinels", () => {
      const targetPath = join(testDir, "AGENTS.md");
      const original = `# Header

Intro text.

<!-- agent-memory:start -->
old
<!-- agent-memory:end -->

## Footer
Footer text.
`;
      writeFileSync(targetPath, original, "utf-8");

      replaceAgentsMdSection(targetPath, "new section");

      const content = readFileSync(targetPath, "utf-8");
      expect(content).toContain("# Header");
      expect(content).toContain("Intro text.");
      expect(content).toContain("new section");
      expect(content).toContain("## Footer");
      expect(content).toContain("Footer text.");
    });
  });

  describe("assignTiers", () => {
    test("correctly partitions entries into hot/warm/cold", () => {
      const entries = [
        createMeta({ id: "id__hot1", title: "Hot Entry" }),
        createMeta({ id: "id__warm1", title: "Warm Entry" }),
        createMeta({ id: "id__cold1", title: "Cold Entry" }),
      ];

      const result = assignTiers(entries, ["id__hot1"], ["id__warm1"]);

      expect(result.hot).toHaveLength(1);
      expect(result.hot[0]!.id).toBe("id__hot1");

      expect(result.warm).toHaveLength(1);
      expect(result.warm[0]!.id).toBe("id__warm1");

      expect(result.cold).toHaveLength(1);
      expect(result.cold[0]!.id).toBe("id__cold1");
    });

    test("handles empty entries", () => {
      const result = assignTiers([], [], []);

      expect(result.hot).toHaveLength(0);
      expect(result.warm).toHaveLength(0);
      expect(result.cold).toHaveLength(0);
    });

    test("handles all entries in one tier", () => {
      const entries = [
        createMeta({ id: "id__a" }),
        createMeta({ id: "id__b" }),
        createMeta({ id: "id__c" }),
      ];

      const result = assignTiers(entries, ["id__a", "id__b", "id__c"], []);

      expect(result.hot).toHaveLength(3);
      expect(result.warm).toHaveLength(0);
      expect(result.cold).toHaveLength(0);
    });

    test("entry not in hot or warm goes to cold", () => {
      const entries = [
        createMeta({ id: "id__a" }),
        createMeta({ id: "id__b" }),
      ];

      const result = assignTiers(entries, ["id__a"], []);

      expect(result.hot).toHaveLength(1);
      expect(result.cold).toHaveLength(1);
      expect(result.cold[0]!.id).toBe("id__b");
    });

    test("hot takes precedence over warm", () => {
      const entries = [createMeta({ id: "id__overlap" })];
      const result = assignTiers(entries, ["id__overlap"], ["id__overlap"]);

      expect(result.hot).toHaveLength(1);
      expect(result.warm).toHaveLength(0);
      expect(result.cold).toHaveLength(0);
    });
  });
});
