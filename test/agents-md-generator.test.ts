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
  tags: [],
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
    test("shows 'no top-of-mind entries yet' with empty top-of-mind", () => {
      const result = generateAgentsMdSection([], []);

      expect(result).toContain("## memory");
      expect(result).toContain("_no top-of-mind entries yet._");
      expect(result).toContain("browse all: `memory list`");
    });

    test("top-of-mind entries rendered as ## title - id with body", () => {
      const topOfMind = [
        {
          meta: createMeta({ id: "id__hot1", title: "Important Pattern" }),
          body: "Always use Result types for error handling.",
        },
      ];

      const result = generateAgentsMdSection(topOfMind, [
        createMeta({ id: "id__hot1", title: "Important Pattern" }),
      ]);

      expect(result).toContain("## Important Pattern - id__hot1");
      expect(result).toContain("Always use Result types for error handling.");
      expect(result).not.toContain("_no top-of-mind entries yet._");
    });

    test("other entries rendered as [[id|title]] links", () => {
      const allEntries = [
        createMeta({ id: "id__other1", title: "Pattern A" }),
        createMeta({ id: "id__other2", title: "Pattern B" }),
      ];

      const result = generateAgentsMdSection([], allEntries);

      expect(result).toContain("- [[id__other1|Pattern A]]");
      expect(result).toContain("- [[id__other2|Pattern B]]");
    });

    test("top-of-mind entries NOT duplicated in the list", () => {
      const topOfMind = [
        {
          meta: createMeta({ id: "id__hot1", title: "Hot Topic" }),
          body: "Hot content here.",
        },
      ];
      const allEntries = [
        createMeta({ id: "id__hot1", title: "Hot Topic" }),
        createMeta({ id: "id__other1", title: "Other Topic" }),
      ];

      const result = generateAgentsMdSection(topOfMind, allEntries);

      expect(result).toContain("## Hot Topic - id__hot1");
      expect(result).toContain("Hot content here.");
      expect(result).toContain("- [[id__other1|Other Topic]]");
      expect(result).not.toContain("[[id__hot1|Hot Topic]]");
    });

    test("includes both top-of-mind and other entries", () => {
      const topOfMind = [
        {
          meta: createMeta({ id: "id__hot1", title: "Hot Topic" }),
          body: "Hot content here.",
        },
      ];
      const allEntries = [
        createMeta({ id: "id__hot1", title: "Hot Topic" }),
        createMeta({ id: "id__warm1", title: "Warm Topic" }),
      ];

      const result = generateAgentsMdSection(topOfMind, allEntries);

      expect(result).toContain("## Hot Topic - id__hot1");
      expect(result).toContain("Hot content here.");
      expect(result).toContain("- [[id__warm1|Warm Topic]]");
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
});
