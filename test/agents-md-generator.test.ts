import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  generateAgentsMdSection,
  wrapInSection,
  replaceAgentsMdSection,
} from "../src/agents-md/generator.js";
import type { MemoryEntryMeta } from "../src/schema.js";

const createMeta = (overrides: Partial<MemoryEntryMeta> = {}): MemoryEntryMeta => ({
  id: "id__abc123",
  title: "Test Entry",
  status: "captured",
  used: 0,
  last_used: "2026-02-13T12:00:00Z",
  org: "default",
  createdAt: 1707849600000,
  updatedAt: 1707849600000,
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
    test("shows 'no memory entries yet' with empty entries", () => {
      const result = generateAgentsMdSection([], []);

      expect(result).toContain("_no memory entries yet._");
    });

    test("includes title, id, and body with top-of-mind entries", () => {
      const topOfMindEntries = [
        {
          meta: createMeta({ id: "id__hot1Xx", title: "Important Pattern" }),
          body: "Always use Result types for error handling.",
        },
      ];

      const result = generateAgentsMdSection(topOfMindEntries, []);

      expect(result).toContain("## Important Pattern - id__hot1Xx");
      expect(result).toContain("Always use Result types for error handling.");
      expect(result).not.toContain("_no memory entries yet._");
    });

    test("shows archive entries as markdown links", () => {
      const archiveEntries = [
        createMeta({ id: "id__warm1x", title: "Pattern A" }),
        createMeta({ id: "id__warm2x", title: "Pattern B", tags: ["topic__x"] }),
      ];

      const result = generateAgentsMdSection([], archiveEntries);

      expect(result).toContain("- [Pattern A](id__warm1x)");
      expect(result).toContain("- [Pattern B](id__warm2x)");
    });

    test("includes both top-of-mind and archive entries", () => {
      const topOfMindEntries = [
        {
          meta: createMeta({ id: "id__hot1Xx", title: "Hot Topic" }),
          body: "Hot content here.",
        },
      ];
      const archiveEntries = [
        createMeta({ id: "id__warm1x", title: "Warm Topic" }),
      ];

      const result = generateAgentsMdSection(topOfMindEntries, archiveEntries);

      expect(result).toContain("## Hot Topic - id__hot1Xx");
      expect(result).toContain("Hot content here.");
      expect(result).toContain("- [Warm Topic](id__warm1x)");
    });
  });

  describe("wrapInSection", () => {
    test("adds sentinel comments", () => {
      const content = "some content";
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
      const section = "test content";

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
old content
<!-- agent-memory:end -->

## Other Section
`;
      writeFileSync(targetPath, original, "utf-8");

      replaceAgentsMdSection(targetPath, "new content");

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

      replaceAgentsMdSection(targetPath, "appended content");

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
});
