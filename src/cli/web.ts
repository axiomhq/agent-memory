/**
 * memory web — lightweight local browser UI for browsing and editing memories.
 */

import { parseArgs } from "util";
import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter } from "../persist/filesystem.js";
import { createMemoryService } from "../service.js";

interface EntrySummary {
  id: string;
  title: string;
  tags: string[];
  org: string;
  source: SourceKind;
  excerpt: string;
  createdAt: string | null;
  updatedAt: string | null;
  displayDate: string | null;
}

type ApiEntry = {
  id: string;
  title: string;
  tags: string[];
  org: string;
  body: string;
  source: SourceKind;
  summaryHtml: string;
  keyPointsHtml: string;
  contentHtml: string;
  metadataHtml: string;
  createdAt: string | null;
  updatedAt: string | null;
  displayDate: string | null;
};

type SourceKind = "chatgpt" | "claude" | "codex" | "project-context" | "manual";

interface BrowserDerivedEntry {
  source: SourceKind;
  excerpt: string;
  summary: string;
  keyPoints: string;
  content: string;
  metadata: string;
  createdAt: string | null;
  updatedAt: string | null;
  displayDate: string | null;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

function text(data: string, init?: ResponseInit): Response {
  return new Response(data, {
    headers: { "content-type": "text/plain; charset=utf-8" },
    ...init,
  });
}

function compactText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<details>[\s\S]*?<\/details>/gi, " ")
    .replace(/^#+\s+/gm, "")
    .replace(/^#\S+.*$/gm, " ")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(body: string, length = 180): string {
  const compact = compactText(body);
  return compact.length > length ? `${compact.slice(0, length - 3)}...` : compact;
}

function normalizeSource(value: string): SourceKind | null {
  const source = value.toLowerCase();
  if (source.includes("chatgpt") || source.includes("openai")) return "chatgpt";
  if (source.includes("claude") || source.includes("anthropic")) return "claude";
  if (source.includes("codex")) return "codex";
  if (
    source.includes("project-context") ||
    source.includes("markdown-context") ||
    source.includes("context-import") ||
    source.includes("document imported")
  ) {
    return "project-context";
  }
  if (source.includes("manual")) return "manual";
  return null;
}

function inferSource(tags: string[], body: string): SourceKind {
  const providerMatch = body.match(/source_provider:\s*([^\n]+)/i);
  const sourceLine = body.match(/## Source\s+([\s\S]*?)(?:\n## |\n<details>|$)/i);
  const fromProvider = providerMatch ? normalizeSource(providerMatch[1] ?? "") : null;
  const fromSourceLine = sourceLine ? normalizeSource(sourceLine[1] ?? "") : null;
  const fromTags = normalizeSource(tags.join(" "));
  return fromProvider ?? fromSourceLine ?? fromTags ?? "manual";
}

function parseDateValue(value: string): string | null {
  const clean = value.trim();
  if (!clean) return null;

  const numeric = Number(clean);
  const date = Number.isFinite(numeric) && numeric > 1000000000
    ? new Date(numeric < 100000000000 ? numeric * 1000 : numeric)
    : new Date(clean);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractDate(body: string, key: "createdAt" | "updatedAt"): string | null {
  const camel = body.match(new RegExp(`[-*]?\\s*${key}:\\s*([^\\n]+)`, "i"));
  if (camel) return parseDateValue(camel[1] ?? "");

  const snakeKey = key === "createdAt" ? "created_at" : "updated_at";
  const snake = body.match(new RegExp(`[-*]?\\s*${snakeKey}:\\s*([^\\n]+)`, "i"));
  return snake ? parseDateValue(snake[1] ?? "") : null;
}

function displayDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

function extractMarkdownSection(body: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`^##\\s+${escapedHeading}\\s*$([\\s\\S]*?)(?=^##\\s+|^<details>|(?![\\s\\S]))`, "im"));
  return match?.[1]?.trim() ?? "";
}

function removeMarkdownSection(body: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`^##\\s+${escapedHeading}\\s*$[\\s\\S]*?(?=^##\\s+|^<details>|(?![\\s\\S]))`, "gim"), "").trim();
}

function extractDetailsBlock(body: string, summary: string): string {
  const escapedSummary = summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`<details>\\s*<summary>\\s*${escapedSummary}\\s*<\\/summary>[\\s\\S]*?<\\/details>`, "i"));
  return match?.[0]?.trim() ?? "";
}

function stripDetailsBlock(body: string, summary: string): string {
  const escapedSummary = summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`<details>\\s*<summary>\\s*${escapedSummary}\\s*<\\/summary>[\\s\\S]*?<\\/details>`, "gi"), "").trim();
}

function detailsBlockContent(block: string): string {
  return block
    .replace(/^<details>\s*<summary>[\s\S]*?<\/summary>/i, "")
    .replace(/<\/details>\s*$/i, "")
    .trim();
}

function stripMigrationBoilerplate(body: string): string {
  const withoutLeadingTags = body.replace(/^#migrated_from_mac_agentmemory_v0917[^\n]*\n+/i, "");
  return removeMarkdownSection(withoutLeadingTags, "Source");
}

function cleanDisplaySection(section: string): string {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const normalized = line.replace(/^[-*]\s+/, "").toLowerCase();
      return !(
        normalized.startsWith("imported ") ||
        normalized.startsWith("the importer had already ") ||
        normalized === "migrated local codex memory file." ||
        normalized === "migrated local memory file."
      );
    })
    .map((line) => line.replace(/^[-*]\s+Opening request\/context:\s*/i, "- "))
    .join("\n")
    .trim();
}

function deriveBrowserEntry(tags: string[], body: string): BrowserDerivedEntry {
  const source = inferSource(tags, body);
  const summary = cleanDisplaySection(extractMarkdownSection(body, "Summary"));
  const keyPoints = cleanDisplaySection(extractMarkdownSection(body, "Key Points"));
  const sourceSection = extractMarkdownSection(body, "Source");
  const migrationMetadata = extractDetailsBlock(body, "Migration metadata");

  let content = stripMigrationBoilerplate(body);
  content = removeMarkdownSection(content, "Summary");
  content = removeMarkdownSection(content, "Key Points");
  content = stripDetailsBlock(content, "Migration metadata");

  const metadataParts = [
    sourceSection ? `## Source\n\n${sourceSection}` : "",
    migrationMetadata ? `## Migration metadata\n\n${detailsBlockContent(migrationMetadata)}` : "",
    extractMarkdownSection(body, "Migration metadata") ? `## Migration metadata\n\n${extractMarkdownSection(body, "Migration metadata")}` : "",
    extractMarkdownSection(body, "Raw provenance") ? `## Raw provenance\n\n${extractMarkdownSection(body, "Raw provenance")}` : "",
    extractMarkdownSection(body, "Original IDs") ? `## Original IDs\n\n${extractMarkdownSection(body, "Original IDs")}` : "",
  ].filter(Boolean);

  const createdAt = extractDate(body, "createdAt");
  const updatedAt = extractDate(body, "updatedAt");
  const bestDate = updatedAt ?? createdAt;

  return {
    source,
    excerpt: shorten(keyPoints || summary || content || body),
    summary,
    keyPoints,
    content: content.trim(),
    metadata: metadataParts.join("\n\n").trim(),
    createdAt,
    updatedAt,
    displayDate: displayDate(bestDate),
  };
}

function renderInlineMarkdown(value: string): string {
  return esc(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\[\[([^\]]+)\]\]/g, "<code>[[$1]]</code>");
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.trim().split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let inList = false;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!inList) return;
    html.push("</ul>");
    inList = false;
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushParagraph();
      closeList();
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      html.push(`${esc(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(heading[1]?.length ?? 2, 4);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2] ?? "")}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(bullet[1] ?? "")}</li>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

function renderPage(baseUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>agent-memory</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0f14;
      --bg-elev: #111822;
      --panel: rgba(18, 24, 34, 0.88);
      --panel-strong: #182131;
      --line: rgba(255,255,255,0.09);
      --text: #e8edf7;
      --muted: #96a2b8;
      --accent: #7ee4c3;
      --accent-2: #f3b76a;
      --danger: #ff6b6b;
      --shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
      --radius: 18px;
      --radius-sm: 12px;
      --mono: "SFMono-Regular", "SF Mono", "Cascadia Code", "IBM Plex Mono", "DejaVu Sans Mono", monospace;
      --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      --sans: "Avenir Next", "Segoe UI", system-ui, sans-serif;
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      color: var(--text);
      font-family: var(--sans);
      background:
        radial-gradient(circle at 20% 20%, rgba(126, 228, 195, 0.12), transparent 24%),
        radial-gradient(circle at 85% 10%, rgba(243, 183, 106, 0.16), transparent 26%),
        linear-gradient(180deg, #0a0e13 0%, #0b1018 45%, #090c11 100%);
    }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      backdrop-filter: blur(18px);
      background: rgba(9, 12, 17, 0.72);
      border-bottom: 1px solid var(--line);
      box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset;
    }

    .topbar-inner {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 16px;
      align-items: center;
      max-width: 1600px;
      margin: 0 auto;
      padding: 18px 24px;
    }

    .brand {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .brand h1 {
      margin: 0;
      font-family: var(--serif);
      font-size: 1.9rem;
      font-weight: 700;
      letter-spacing: 0.01em;
      line-height: 1;
    }

    .brand p {
      margin: 0;
      color: var(--muted);
      font-size: 0.92rem;
    }

    .toolbar {
      display: grid;
      grid-template-columns: minmax(240px, 1.3fr) 180px auto auto auto;
      gap: 10px;
    }

    input, textarea, select, button {
      font: inherit;
    }

    .field, .select, .textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(17, 24, 34, 0.82);
      color: var(--text);
      padding: 12px 14px;
      outline: none;
      box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset;
    }

    .field::placeholder, .textarea::placeholder { color: #6f7b8f; }
    .field:focus, .select:focus, .textarea:focus { border-color: rgba(126, 228, 195, 0.5); box-shadow: 0 0 0 3px rgba(126, 228, 195, 0.12); }

    .btn {
      border: 0;
      border-radius: 14px;
      padding: 12px 15px;
      cursor: pointer;
      color: #081019;
      background: linear-gradient(135deg, var(--accent), #a8f5df);
      font-weight: 700;
      box-shadow: 0 10px 30px rgba(126, 228, 195, 0.15);
    }

    .btn.secondary {
      color: var(--text);
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--line);
      box-shadow: none;
    }

    .btn[disabled] {
      opacity: 0.48;
      cursor: not-allowed;
    }

    .btn.danger {
      color: #1f0404;
      background: linear-gradient(135deg, #ff7c7c, #ffae8a);
    }

    .main {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 18px;
      max-width: 1600px;
      margin: 0 auto;
      width: 100%;
      padding: 18px 24px 24px;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .panel-head {
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent);
    }

    .panel-title {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .panel-title h2 {
      margin: 0;
      font-size: 0.98rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .panel-title span {
      color: var(--muted);
      font-size: 0.85rem;
    }

    .list {
      max-height: calc(100vh - 260px);
      overflow: auto;
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: rgba(0,0,0,0.12);
    }

    .filter-chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 7px 10px;
      color: var(--muted);
      background: rgba(255,255,255,0.04);
      cursor: pointer;
      font-size: 0.8rem;
      line-height: 1;
    }

    .filter-chip[aria-pressed="true"] {
      color: #081019;
      border-color: transparent;
      background: var(--accent);
      font-weight: 700;
    }

    .entry {
      display: block;
      width: 100%;
      text-align: left;
      color: inherit;
      padding: 15px 18px;
      border: 0;
      border-left: 3px solid transparent;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      background: transparent;
      cursor: pointer;
    }

    .entry:hover {
      background: rgba(255,255,255,0.05);
    }

    .entry[aria-selected="true"] {
      background: rgba(126, 228, 195, 0.09);
      border-left-color: var(--accent);
    }

    .entry-title {
      margin: 0 0 6px;
      font-size: 1.02rem;
      line-height: 1.3;
      font-weight: 650;
    }

    .entry-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--muted);
      font-size: 0.82rem;
      font-family: var(--mono);
    }

    .entry-excerpt {
      margin: 10px 0 0;
      color: #b9c3d6;
      font-size: 0.9rem;
      line-height: 1.45;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      padding: 5px 9px;
      background: rgba(255,255,255,0.07);
      color: #dce4f3;
      font-size: 0.8rem;
      line-height: 1;
    }

    .chip.accent { background: rgba(126, 228, 195, 0.14); color: #bef7e3; }
    .chip.warn { background: rgba(243, 183, 106, 0.15); color: #ffd6a2; }

    .chip.source {
      background: rgba(126, 228, 195, 0.13);
      color: #c7f8e9;
      font-family: var(--mono);
    }

    .detail {
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      min-height: calc(100vh - 150px);
    }

    .detail-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .detail-head h3 {
      margin: 0;
      font-family: var(--serif);
      font-size: 2rem;
      line-height: 1.06;
    }

    .subtle {
      color: var(--muted);
      font-size: 0.92rem;
      line-height: 1.5;
    }

    .stack { display: flex; flex-wrap: wrap; gap: 8px; }

    .reader {
      padding: 22px;
      overflow: auto;
    }

    .reader-section {
      margin: 0 0 24px;
    }

    .reader-section h4 {
      margin: 0 0 10px;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .markdown {
      color: #e6ecf6;
      line-height: 1.68;
      max-width: 900px;
    }

    .markdown h1, .markdown h2, .markdown h3, .markdown h4 {
      margin: 1.35rem 0 0.55rem;
      font-family: var(--serif);
      line-height: 1.18;
    }

    .markdown h1 { font-size: 1.55rem; }
    .markdown h2 { font-size: 1.34rem; }
    .markdown h3 { font-size: 1.15rem; }
    .markdown p { margin: 0 0 0.95rem; }
    .markdown ul { margin: 0 0 1rem 1.2rem; padding: 0; }
    .markdown li { margin: 0.35rem 0; }
    .markdown code {
      font-family: var(--mono);
      background: rgba(255,255,255,0.07);
      border-radius: 6px;
      padding: 0.08rem 0.32rem;
    }
    .markdown pre {
      overflow: auto;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(0,0,0,0.25);
    }
    .markdown pre code {
      padding: 0;
      background: transparent;
    }

    .metadata {
      max-width: 900px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(255,255,255,0.035);
      padding: 12px 14px;
    }

    .metadata summary {
      cursor: pointer;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.82rem;
    }

    .metadata .markdown {
      margin-top: 14px;
      color: #b9c3d6;
      font-size: 0.9rem;
    }

    .editor {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      padding: 18px;
    }

    .block {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .block label {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      font-family: var(--mono);
    }

    .textarea {
      min-height: 52vh;
      resize: vertical;
      line-height: 1.55;
      font-family: var(--mono);
      white-space: pre-wrap;
    }

    .readonly {
      white-space: pre-wrap;
      overflow: auto;
      min-height: 52vh;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(255,255,255,0.03);
      line-height: 1.6;
      font-family: var(--mono);
    }

    [hidden] { display: none !important; }

    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 16px 18px 18px;
      border-top: 1px solid var(--line);
    }

    .notice {
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      color: #dce4f3;
      background: rgba(126, 228, 195, 0.07);
    }

    .empty {
      color: var(--muted);
      padding: 18px;
      line-height: 1.6;
    }

    .small {
      font-size: 0.82rem;
      color: var(--muted);
      font-family: var(--mono);
    }

    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    @media (max-width: 1100px) {
      .topbar-inner, .toolbar, .main, .editor {
        grid-template-columns: 1fr;
      }

      .list {
        max-height: 320px;
      }

      .detail {
        min-height: auto;
      }

      .textarea, .readonly {
        min-height: 320px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <h1>agent-memory</h1>
          <p>local memory browser · ${esc(baseUrl)}</p>
        </div>
        <div class="toolbar">
          <input id="search" class="field" placeholder="Search title, tags, or body" />
          <select id="org" class="select">
            <option value="">all orgs</option>
          </select>
          <button class="btn secondary" id="refresh">refresh</button>
          <button class="btn secondary" id="newEntry">new entry</button>
          <button class="btn" id="saveDraft" disabled>save</button>
        </div>
      </div>
    </header>

    <main class="main">
      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">
            <h2>library</h2>
            <span id="countLabel">loading…</span>
          </div>
          <span class="chip accent" id="healthChip">online</span>
        </div>
        <div id="notice" class="notice" hidden></div>
        <div class="filters" id="sourceFilters">
          <button class="filter-chip" data-source="" aria-pressed="true">all</button>
          <button class="filter-chip" data-source="chatgpt" aria-pressed="false">chatgpt</button>
          <button class="filter-chip" data-source="claude" aria-pressed="false">claude</button>
          <button class="filter-chip" data-source="codex" aria-pressed="false">codex</button>
          <button class="filter-chip" data-source="project-context" aria-pressed="false">project-context</button>
          <button class="filter-chip" data-source="manual" aria-pressed="false">manual</button>
        </div>
        <div id="list" class="list"></div>
      </section>

      <section class="panel detail">
        <div class="panel-head">
          <div class="detail-head">
            <div>
              <h3 id="detailTitle">select a memory</h3>
              <div id="detailMeta" class="subtle">markdown files on disk</div>
              <div id="detailTags" class="stack" style="margin-top:10px"></div>
            </div>
          </div>
          <div class="actions">
            <button class="btn secondary" id="editEntry" disabled>edit</button>
            <button class="btn secondary" id="deleteEntry" disabled>delete</button>
          </div>
        </div>

        <div id="reader" class="reader">
          <div id="summarySection" class="reader-section" hidden>
            <h4>summary</h4>
            <div id="summaryPreview" class="markdown"></div>
          </div>
          <div id="keyPointsSection" class="reader-section" hidden>
            <h4>key points</h4>
            <div id="keyPointsPreview" class="markdown"></div>
          </div>
          <div id="contentPreview" class="markdown empty">select a memory from the library.</div>
          <details id="metadataSection" class="metadata" hidden>
            <summary>metadata/source</summary>
            <div id="metadataPreview" class="markdown"></div>
          </details>
        </div>

        <div id="editor" class="editor" hidden>
          <div class="block">
            <label for="editTitle">title</label>
            <input id="editTitle" class="field" placeholder="memory title" />
          </div>
          <div class="block">
            <label for="editTags">tags</label>
            <input id="editTags" class="field" placeholder="tag1, tag2" />
          </div>
          <div class="block">
            <label for="editOrg">org</label>
            <input id="editOrg" class="field" placeholder="default" />
          </div>
          <div class="block">
            <label for="captureOrg">new entry org</label>
            <input id="captureOrg" class="field" placeholder="default" />
          </div>
          <div class="block" style="grid-column: 1 / -1">
            <label for="editBody">body</label>
            <textarea id="editBody" class="textarea" placeholder="markdown body…"></textarea>
          </div>
        </div>

        <div class="footer">
          <div>
            <div id="detailId" class="small">no entry selected</div>
            <div id="linkLine" class="small"></div>
          </div>
          <div class="actions" id="captureActions" hidden>
            <button class="btn secondary" id="clearDraft">clear</button>
            <button class="btn" id="captureEntry">capture</button>
          </div>
        </div>
        <div id="capturePanel" class="editor" hidden>
          <div class="block" style="grid-column: 1 / -1">
            <label for="captureBody">quick capture</label>
            <textarea id="captureBody" class="textarea" placeholder="write a fresh memory here…"></textarea>
          </div>
        </div>
      </section>
    </main>
  </div>

  <script>
    const state = {
      entries: [],
      current: null,
      query: "",
      org: "",
      source: "",
      editing: false,
    };
    let searchTimer = null;

    const el = (id) => document.getElementById(id);

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function tagList(tags) {
      const visible = (tags || []).filter((tag) => ![
        "migrated_from_mac_agentmemory_v0917",
        "conversation_import",
      ].includes(tag));
      return visible.length ? visible.slice(0, 6).map((tag) => '<span class="chip">' + escapeHtml(tag) + '</span>').join(' ') : '<span class="small">no tags</span>';
    }

    function sourceChip(source) {
      return '<span class="chip source">' + escapeHtml(source || "manual") + '</span>';
    }

    function updateFilterButtons() {
      document.querySelectorAll("#sourceFilters .filter-chip").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.source === state.source ? "true" : "false");
      });
    }

    function setEditMode(enabled) {
      state.editing = enabled && Boolean(state.current);
      el("reader").hidden = state.editing;
      el("editor").hidden = !state.editing;
      el("saveDraft").disabled = !state.editing || !state.current;
      el("editEntry").textContent = state.editing ? "preview" : "edit";
    }

    function setNotice(message, kind = "info") {
      const box = el("notice");
      if (!message) {
        box.hidden = true;
        box.textContent = "";
        return;
      }
      box.hidden = false;
      box.textContent = message;
      box.style.background = kind === "error" ? "rgba(255,107,107,0.12)" : "rgba(126,228,195,0.07)";
    }

    function selectedId() {
      return state.current ? state.current.id : "";
    }

    async function request(path, options) {
      const response = await fetch(path, {
        headers: { "content-type": "application/json" },
        ...options,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
      }
      const contentType = response.headers.get("content-type") || "";
      return contentType.includes("application/json") ? response.json() : response.text();
    }

    async function loadMeta() {
      const meta = await request("/api/meta");
      const org = el("org");
      const captureOrg = el("captureOrg");
      org.innerHTML = '<option value="">all orgs</option>' + meta.orgs.map((value) => '<option value="' + value + '">' + value + '</option>').join('');
      captureOrg.value = meta.defaultOrg || "default";
      org.value = state.org;
      el("healthChip").textContent = meta.health.ok ? "healthy" : "needs attention";
      el("countLabel").textContent = "Showing 0 of " + meta.count + " entries";
    }

    async function loadList() {
      const params = new URLSearchParams();
      if (state.query) params.set("query", state.query);
      if (state.org) params.set("org", state.org);
      if (state.source) params.set("source", state.source);
      params.set("limit", "500");
      const data = await request("/api/entries?" + params.toString());
      state.entries = data.entries;
      el("countLabel").textContent = "Showing " + data.entries.length + " of " + data.total + " entries";
      renderList();
    }

    function renderList() {
      const list = el("list");
      if (!state.entries.length) {
        list.innerHTML = '<div class="empty">no entries match the current filter.</div>';
        return;
      }
      list.innerHTML = state.entries.map((entry) => {
        const selected = selectedId() === entry.id;
        return '<button class="entry" data-id="' + entry.id + '" aria-selected="' + selected + '">' +
          '<p class="entry-title">' + escapeHtml(entry.title) + '</p>' +
          '<div class="entry-meta">' +
          sourceChip(entry.source) +
          (entry.displayDate ? '<span>' + escapeHtml(entry.displayDate) + '</span>' : '') +
          tagList(entry.tags) +
          '</div>' +
          '<p class="entry-excerpt">' + escapeHtml(entry.excerpt) + '</p>' +
        '</button>';
      }).join("");
      list.querySelectorAll(".entry").forEach((button) => {
        button.addEventListener("click", () => openEntry(button.dataset.id));
      });
    }

    function fillEditor(entry) {
      el("detailTitle").textContent = entry ? entry.title : "select a memory";
      el("detailMeta").innerHTML = entry
        ? sourceChip(entry.source) + (entry.displayDate ? ' <span>' + escapeHtml(entry.displayDate) + '</span>' : '')
        : "markdown files on disk";
      el("detailTags").innerHTML = entry ? tagList(entry.tags) : "";
      el("detailId").textContent = entry ? entry.id + " · " + entry.org : "no entry selected";
      el("linkLine").innerHTML = entry ? "" : "";
      el("editTitle").value = entry ? entry.title : "";
      el("editTags").value = entry ? (entry.tags || []).join(", ") : "";
      el("editOrg").value = entry ? entry.org : "";
      el("editBody").value = entry ? entry.body : "";
      el("summaryPreview").innerHTML = entry ? entry.summaryHtml : "";
      el("summarySection").hidden = !entry || !entry.summaryHtml;
      el("keyPointsPreview").innerHTML = entry ? entry.keyPointsHtml : "";
      el("keyPointsSection").hidden = !entry || !entry.keyPointsHtml;
      el("contentPreview").innerHTML = entry ? (entry.contentHtml || '<div class="empty">no previewable content.</div>') : "select a memory from the library.";
      el("metadataPreview").innerHTML = entry ? entry.metadataHtml : "";
      el("metadataSection").hidden = !entry || !entry.metadataHtml;
      el("editEntry").disabled = !entry;
      el("deleteEntry").disabled = !entry;
      el("captureActions").hidden = true;
      if (!entry) setEditMode(false);
    }

    async function openEntry(id) {
      if (!id) return;
      const data = await request("/api/entries/" + encodeURIComponent(id));
      state.current = data.entry;
      fillEditor(state.current);
      setEditMode(false);
      el("capturePanel").hidden = true;
      el("captureActions").hidden = true;
      renderList();
    }

    async function saveCurrent() {
      if (!state.current) {
        setNotice("pick an entry first, or use capture for a new one.", "error");
        return;
      }
      const id = state.current.id;
      const payload = {
        title: el("editTitle").value.trim(),
        body: el("editBody").value,
        tags: el("editTags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
        org: el("editOrg").value.trim() || "default",
      };
      await request("/api/entries/" + encodeURIComponent(id), {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setNotice("saved " + id);
      setEditMode(false);
      await refreshAll(id);
    }

    async function captureEntry() {
      const title = el("editTitle").value.trim() || "untitled";
      const body = el("captureBody").value.trim();
      if (!body) {
        setNotice("capture body is empty.", "error");
        return;
      }
      const payload = {
        title,
        body,
        tags: el("editTags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
        org: el("captureOrg").value.trim() || "default",
      };
      const result = await request("/api/entries", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice("captured " + result.entry.meta.id);
      el("captureBody").value = "";
      el("capturePanel").hidden = true;
      el("captureActions").hidden = true;
      await refreshAll(result.entry.meta.id);
    }

    async function deleteCurrent() {
      if (!state.current) return;
      if (!confirm("delete " + state.current.title + "?")) return;
      await request("/api/entries/" + encodeURIComponent(state.current.id), {
        method: "DELETE",
      });
      setNotice("deleted " + state.current.id);
      state.current = null;
      fillEditor(null);
      setEditMode(false);
      await refreshAll();
    }

    async function refreshAll(selectedId = "") {
      await Promise.all([loadMeta(), loadList()]);
      if (selectedId) {
        try {
          await openEntry(selectedId);
        } catch {
          state.current = null;
          fillEditor(null);
        }
      }
    }

    el("search").addEventListener("input", (event) => {
      state.query = event.target.value;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        loadList().catch((error) => setNotice(error.message, "error"));
      }, 180);
    });

    el("org").addEventListener("change", (event) => {
      state.org = event.target.value;
      loadList().catch((error) => setNotice(error.message, "error"));
    });

    document.querySelectorAll("#sourceFilters .filter-chip").forEach((button) => {
      button.addEventListener("click", () => {
        state.source = button.dataset.source || "";
        updateFilterButtons();
        loadList().catch((error) => setNotice(error.message, "error"));
      });
    });

    el("refresh").addEventListener("click", () => refreshAll(selectedId()).catch((error) => setNotice(error.message, "error")));
    el("editEntry").addEventListener("click", () => setEditMode(!state.editing));
    el("newEntry").addEventListener("click", () => {
      state.current = null;
      fillEditor(null);
      el("editor").hidden = false;
      el("reader").hidden = true;
      el("capturePanel").hidden = false;
      el("captureActions").hidden = false;
      el("saveDraft").disabled = true;
      el("editTitle").focus();
      setNotice("new entry draft ready.");
    });
    el("saveDraft").addEventListener("click", () => saveCurrent().catch((error) => setNotice(error.message, "error")));
    el("captureEntry").addEventListener("click", () => captureEntry().catch((error) => setNotice(error.message, "error")));
    el("deleteEntry").addEventListener("click", () => deleteCurrent().catch((error) => setNotice(error.message, "error")));
    el("clearDraft").addEventListener("click", () => {
      el("captureBody").value = "";
      setNotice("draft cleared.");
    });

    refreshAll().catch((error) => setNotice(error.message, "error"));
  </script>
</body>
</html>`;
}

export async function run(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "3333" },
    },
    strict: true,
  });

  const config = loadConfig();
  const rootDir = expandPath(config.storage.root);
  const adapter = createFileMemoryPersistenceAdapter({ rootDir });
  const service = createMemoryService(adapter);
  const host = values.host ?? "127.0.0.1";
  const port = Number.parseInt(values.port ?? "3333", 10);

  const server = Bun.serve({
    hostname: host,
    port,
    fetch: async (request) => {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/") {
        return new Response(renderPage(`${url.protocol}//${url.host}`), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (request.method === "GET" && url.pathname === "/api/meta") {
        const [listResult, brokenResult] = await Promise.all([
          service.list(),
          service.brokenLinks(),
        ]);

        if (listResult.isErr()) {
          return json({ error: listResult.error.message }, { status: 500 });
        }
        if (brokenResult.isErr()) {
          return json({ error: brokenResult.error.message }, { status: 500 });
        }

        const orgs = [...new Set(listResult.value.map((entry) => entry.org))].sort();
        return json({
          root: rootDir,
          defaultOrg: orgs[0] ?? "default",
          orgs,
          count: listResult.value.length,
          health: { ok: brokenResult.value.length === 0 },
        });
      }

      if (request.method === "GET" && url.pathname === "/api/entries") {
        const query = url.searchParams.get("query") ?? undefined;
        const org = url.searchParams.get("org") ?? undefined;
        const source = url.searchParams.get("source") as SourceKind | null;
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "500", 10);
        const result = await service.list({
          org: org || undefined,
        });

        if (result.isErr()) {
          return json({ error: result.error.message }, { status: 500 });
        }

        const entries: EntrySummary[] = [];
        for (const entry of result.value) {
          const readResult = await service.read(entry.id);
          const body = readResult.isOk() ? readResult.value.body : "";
          const derived = deriveBrowserEntry(entry.tags ?? [], body);
          const searchText = `${entry.title}\n${entry.tags.join(" ")}\n${body}`.toLowerCase();
          if (query && !searchText.includes(query.toLowerCase())) continue;
          if (source && derived.source !== source) continue;

          entries.push({
            id: entry.id,
            title: entry.title,
            tags: entry.tags ?? [],
            org: entry.org,
            source: derived.source,
            excerpt: derived.excerpt,
            createdAt: derived.createdAt,
            updatedAt: derived.updatedAt,
            displayDate: derived.displayDate,
          });
        }

        entries.sort((a, b) => {
          const aDate = a.updatedAt ?? a.createdAt;
          const bDate = b.updatedAt ?? b.createdAt;
          if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
          if (aDate && !bDate) return -1;
          if (!aDate && bDate) return 1;
          return a.title.localeCompare(b.title);
        });

        return json({ entries: entries.slice(0, limit), total: entries.length, limit });
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/entries/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/entries/".length));
        const entryResult = await service.read(id);
        if (entryResult.isErr()) {
          return json({ error: entryResult.error.message }, { status: 404 });
        }
        const derived = deriveBrowserEntry(entryResult.value.meta.tags ?? [], entryResult.value.body);
        return json({
          entry: {
            id: entryResult.value.meta.id,
            title: entryResult.value.meta.title,
            tags: entryResult.value.meta.tags ?? [],
            org: entryResult.value.meta.org,
            body: entryResult.value.body,
            source: derived.source,
            summaryHtml: renderMarkdown(derived.summary),
            keyPointsHtml: renderMarkdown(derived.keyPoints),
            contentHtml: renderMarkdown(derived.content),
            metadataHtml: renderMarkdown(derived.metadata),
            createdAt: derived.createdAt,
            updatedAt: derived.updatedAt,
            displayDate: derived.displayDate,
          } satisfies ApiEntry,
          links: null,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/entries") {
        const payload = await request.json().catch(() => null);
        if (!payload || typeof payload !== "object") {
          return json({ error: "invalid JSON body" }, { status: 400 });
        }
        const data = payload as Partial<Record<"title" | "body" | "org" | "tags", unknown>>;
        const title = typeof data.title === "string" ? data.title.trim() : "";
        const body = typeof data.body === "string" ? data.body : "";
        const org = typeof data.org === "string" && data.org.trim() ? data.org.trim() : "default";
        const tags = Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean) : [];
        if (!title || !body) {
          return json({ error: "title and body are required" }, { status: 400 });
        }
        const result = await service.capture({ title, body, tags, org });
        if (result.isErr()) {
          return json({ error: result.error.message }, { status: 500 });
        }
        return json({
          entry: {
            meta: result.value.meta,
            body: result.value.body,
          },
        }, { status: 201 });
      }

      if (request.method === "PUT" && url.pathname.startsWith("/api/entries/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/entries/".length));
        const payload = await request.json().catch(() => null);
        if (!payload || typeof payload !== "object") {
          return json({ error: "invalid JSON body" }, { status: 400 });
        }
        const data = payload as Partial<Record<"title" | "body" | "org" | "tags", unknown>>;
        const title = typeof data.title === "string" ? data.title.trim() : "";
        const body = typeof data.body === "string" ? data.body : null;
        const tags = Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean) : null;

        if (body !== null) {
          const bodyResult = await service.updateBody(id, body);
          if (bodyResult.isErr()) {
            return json({ error: bodyResult.error.message }, { status: 500 });
          }
        }

        if (title || tags) {
          const metaResult = await service.updateMeta(id, {
            ...(title ? { title } : {}),
            ...(tags ? { tags } : {}),
          });
          if (metaResult.isErr()) {
            return json({ error: metaResult.error.message }, { status: 500 });
          }
        }

        return json({ ok: true });
      }

      if (request.method === "DELETE" && url.pathname.startsWith("/api/entries/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/entries/".length));
        const result = await service.remove(id);
        if (result.isErr()) {
          return json({ error: result.error.message }, { status: 500 });
        }
        return text("deleted");
      }

      return new Response("not found", { status: 404 });
    },
  });

  console.log(`memory web running at http://${server.hostname}:${server.port}`);
  console.log(`root: ${rootDir}`);
  console.log("press ctrl-c to stop");
}
