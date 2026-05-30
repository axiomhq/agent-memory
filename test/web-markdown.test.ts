import { describe, test, expect } from "bun:test";
import { esc, renderInlineMarkdown, renderMarkdown } from "../src/web/markdown.js";

describe("web/markdown", () => {
  describe("esc", () => {
    test("escapes HTML characters", () => {
      expect(esc("&<>\u0022'")).toBe("&amp;&lt;&gt;&quot;&#39;");
    });
  });

  describe("renderInlineMarkdown", () => {
    test("renders code spans", () => {
      expect(renderInlineMarkdown("`code`")).toBe("<code>code</code>");
    });

    test("renders bold", () => {
      expect(renderInlineMarkdown("**bold**")).toBe("<strong>bold</strong>");
    });

    test("renders links", () => {
      expect(renderInlineMarkdown("[link](https://example.com)")).toBe('<a href="https://example.com" target="_blank" rel="noreferrer">link</a>');
    });

    test("renders wikilinks", () => {
      expect(renderInlineMarkdown("[[wiki]]")).toBe("<code>[[wiki]]</code>");
    });
  });

  describe("renderMarkdown", () => {
    test("renders headings", () => {
      expect(renderMarkdown("# H1\n## H2")).toBe("<h1>H1</h1>\n<h2>H2</h2>");
    });

    test("renders lists", () => {
      expect(renderMarkdown("- item 1\n- item 2")).toBe("<ul>\n<li>item 1</li>\n<li>item 2</li>\n</ul>");
    });

    test("renders code fences", () => {
      const output = renderMarkdown("```\ncode\n```");
      console.log('OUTPUT:', JSON.stringify(output));
      expect(output).toBe("<pre><code>\ncode\n\n</code></pre>");
    });
  });
});
