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
  tier: EntryTier;
  classes: EntryClass[];
  topics: TopicKind[];
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
  tier: EntryTier;
  classes: EntryClass[];
  topics: TopicKind[];
  contextHtml: string;
  summaryHtml: string;
  operationalHtml: string;
  contentHtml: string;
  appliesToHtml: string;
  confidenceHtml: string;
  commandsHtml: string;
  metadataHtml: string;
  rawSourceHtml: string;
  createdAt: string | null;
  updatedAt: string | null;
  displayDate: string | null;
};

type SourceKind = "chatgpt" | "claude" | "codex" | "project_context" | "manual" | "unknown";
type EntryTier = "curated" | "raw_archive" | "unknown";
type EntryView = "curated" | "candidates" | "raw" | "action" | "all";
type EntryClass =
  | "raw_import"
  | "curated"
  | "curated_candidate"
  | "duplicate"
  | "stale"
  | "superseded"
  | "action_required"
  | "project_context";
type TopicKind = "workpacker" | "agent_memory" | "mcp" | "github" | "ssen" | "infra";

interface BrowserDerivedEntry {
  source: SourceKind;
  tier: EntryTier;
  classes: EntryClass[];
  topics: TopicKind[];
  excerpt: string;
  context: string;
  summary: string;
  operational: string;
  content: string;
  commands: string;
  appliesTo: string;
  confidence: string;
  metadata: string;
  rawSource: string;
  createdAt: string | null;
  updatedAt: string | null;
  displayDate: string | null;
}

interface StoreCounts {
  curated: number;
  candidates: number;
  rawArchive: number;
  actionRequired: number;
  total: number;
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
    source.includes("project_context") ||
    source.includes("project-context") ||
    source.includes("markdown-context") ||
    source.includes("context-import") ||
    source.includes("document imported")
  ) {
    return "project_context";
  }
  if (source.includes("manual")) return "manual";
  return null;
}

function inferSource(tags: string[], body: string): SourceKind {
  const sourceTag = tags.find((tag) => tag.startsWith("source__"))?.replace(/^source__/, "");
  const fromSourceTag = sourceTag ? normalizeSource(sourceTag) : null;
  const normalizedProvider = normalizedField(body, "Source").match(/provider:\s*([^\n]+)/i)?.[1];
  const providerMatch = body.match(/source_provider:\s*([^\n]+)/i);
  const sourceLine = body.match(/## Source\s+([\s\S]*?)(?:\n## |\n<details>|$)/i);
  const fromNormalizedProvider = normalizedProvider ? normalizeSource(normalizedProvider) : null;
  const fromProvider = providerMatch ? normalizeSource(providerMatch[1] ?? "") : null;
  const fromSourceLine = sourceLine ? normalizeSource(sourceLine[1] ?? "") : null;
  const fromTags = normalizeSource(tags.join(" "));
  return fromSourceTag ?? fromNormalizedProvider ?? fromProvider ?? fromSourceLine ?? fromTags ?? "unknown";
}

function inferTier(tags: string[]): EntryTier {
  if (tags.includes("tier__curated")) return "curated";
  if (tags.includes("tier__raw_archive")) return "raw_archive";
  if (tags.includes("curated")) return "curated";
  return "unknown";
}

function inferClasses(tags: string[]): EntryClass[] {
  const classes = tags
    .filter((tag) => tag.startsWith("class__"))
    .map((tag) => tag.replace(/^class__/, ""))
    .filter((tag): tag is EntryClass =>
      [
        "raw_import",
        "curated",
        "curated_candidate",
        "duplicate",
        "stale",
        "superseded",
        "action_required",
        "project_context",
      ].includes(tag)
    );
  if (tags.includes("curated") && !classes.includes("curated")) classes.push("curated");
  return [...new Set(classes)];
}

function inferTopics(tags: string[]): TopicKind[] {
  return [...new Set(tags
    .filter((tag) => tag.startsWith("topic__"))
    .map((tag) => tag.replace(/^topic__/, ""))
    .filter((tag): tag is TopicKind =>
      ["workpacker", "agent_memory", "mcp", "github", "ssen", "infra"].includes(tag)
    ))];
}

function countEntries(entries: Array<{ tags: string[] }>): StoreCounts {
  return {
    curated: entries.filter((entry) => inferTier(entry.tags) === "curated").length,
    candidates: entries.filter((entry) => inferClasses(entry.tags).includes("curated_candidate")).length,
    rawArchive: entries.filter((entry) => inferTier(entry.tags) === "raw_archive").length,
    actionRequired: entries.filter((entry) => inferClasses(entry.tags).includes("action_required")).length,
    total: entries.length,
  };
}

function matchesView(tags: string[], view: EntryView): boolean {
  const tier = inferTier(tags);
  const classes = inferClasses(tags);
  if (view === "curated") return tier === "curated";
  if (view === "candidates") return classes.includes("curated_candidate");
  if (view === "raw") return tier === "raw_archive";
  if (view === "action") return classes.includes("action_required");
  return true;
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
  const match = body.match(new RegExp(`^##\\s+${escapedHeading}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|^<details>|$)`, "im"));
  return match?.[1]?.trim() ?? "";
}

function removeMarkdownSection(body: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`^##\\s+${escapedHeading}\\s*\\r?\\n[\\s\\S]*?(?=^##\\s+|^<details>|$)`, "gim"), "").trim();
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

const NORMALIZED_FIELDS = [
  "Context",
  "Type",
  "Summary",
  "Operational memory",
  "Commands / config",
  "Applies to",
  "Source",
  "Confidence",
] as const;

function normalizedField(body: string, field: (typeof NORMALIZED_FIELDS)[number]): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nextFields = NORMALIZED_FIELDS
    .filter((candidate) => candidate !== field)
    .map((candidate) => candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const match = body.match(new RegExp(`^${escaped}:\\s*\\r?\\n([\\s\\S]*?)(?=^(?:${nextFields}):\\s*$|^<details>|$)`, "im"));
  return match?.[1]?.trim() ?? "";
}

function rawContentDetails(body: string): string {
  return extractDetailsBlock(body, "Raw content");
}

function stripRawContent(body: string): string {
  return stripDetailsBlock(body, "Raw content");
}

function firstUsefulText(...values: string[]): string {
  for (const value of values) {
    const compact = compactText(value);
    if (compact && !isPlaceholderSection(compact)) return compact;
  }
  return "";
}

function isPlaceholderSection(value: string): boolean {
  const normalized = compactText(value)
    .replace(/^[-*]\s+/, "")
    .replace(/\.$/, "")
    .toLowerCase();
  return ["no compact summary extracted", "none captured", "not captured", "n/a", "none"].includes(normalized);
}

function usefulSection(value: string): string {
  return isPlaceholderSection(value) ? "" : value;
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
  const tier = inferTier(tags);
  const classes = inferClasses(tags);
  const topics = inferTopics(tags);
  const context = usefulSection(cleanDisplaySection(normalizedField(body, "Context")));
  const normalizedSummary = usefulSection(cleanDisplaySection(normalizedField(body, "Summary")));
  const operational = usefulSection(cleanDisplaySection(normalizedField(body, "Operational memory")));
  const commands = usefulSection(cleanDisplaySection(normalizedField(body, "Commands / config")));
  const appliesTo = usefulSection(cleanDisplaySection(normalizedField(body, "Applies to")));
  const confidence = usefulSection(cleanDisplaySection(normalizedField(body, "Confidence")));
  const normalizedSource = cleanDisplaySection(normalizedField(body, "Source"));
  const legacySummary = usefulSection(cleanDisplaySection(extractMarkdownSection(body, "Summary")));
  const keyPoints = usefulSection(cleanDisplaySection(extractMarkdownSection(body, "Key Points")));
  const summary = normalizedSummary || legacySummary;
  const sourceSection = normalizedSource || extractMarkdownSection(body, "Source");
  const migrationMetadata = extractDetailsBlock(body, "Migration metadata");
  const rawSource = rawContentDetails(body);

  let content = stripMigrationBoilerplate(body);
  content = removeMarkdownSection(content, "Summary");
  content = removeMarkdownSection(content, "Key Points");
  content = stripDetailsBlock(content, "Migration metadata");
  content = stripRawContent(content);
  for (const field of NORMALIZED_FIELDS) {
    content = content.replace(new RegExp(`^${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*\\r?\\n[\\s\\S]*?(?=^(?:${NORMALIZED_FIELDS.map((candidate) => candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}):\\s*$|^<details>|$)`, "gim"), "").trim();
  }

  const metadataParts = [
    sourceSection ? `## Provenance\n\n${sourceSection}` : "",
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
    tier,
    classes,
    topics,
    excerpt: shorten(firstUsefulText(summary, operational, context, keyPoints, content, body)),
    context,
    summary,
    operational: operational || keyPoints,
    commands,
    appliesTo,
    confidence,
    content: content.trim(),
    metadata: metadataParts.join("\n\n").trim(),
    rawSource: rawSource ? detailsBlockContent(rawSource) : "",
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

    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: rgba(0,0,0,0.1);
    }

    .stat {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 9px 10px;
      background: rgba(255,255,255,0.035);
    }

    .stat strong {
      display: block;
      font-size: 1.06rem;
      line-height: 1.1;
    }

    .stat span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
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

    .curated-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      max-width: 1100px;
    }

    .memory-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 16px;
      background: rgba(255,255,255,0.035);
    }

    .memory-card.full {
      grid-column: 1 / -1;
    }

    .memory-card h4 {
      margin: 0 0 10px;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
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

      .stats, .curated-grid {
        grid-template-columns: 1fr;
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
        <div class="filters" id="viewFilters">
          <button class="filter-chip" data-view="curated" aria-pressed="false">curated</button>
          <button class="filter-chip" data-view="candidates" aria-pressed="false">curated candidates</button>
          <button class="filter-chip" data-view="raw" aria-pressed="false">raw archive</button>
          <button class="filter-chip" data-view="action" aria-pressed="false">action required</button>
          <button class="filter-chip" data-view="all" aria-pressed="false">all</button>
        </div>
        <div class="stats">
          <div class="stat"><strong id="curatedCount">0</strong><span>curated</span></div>
          <div class="stat"><strong id="candidateCount">0</strong><span>candidates</span></div>
          <div class="stat"><strong id="rawCount">0</strong><span>raw archive</span></div>
        </div>
        <div class="filters" id="sourceFilters">
          <button class="filter-chip" data-source="" aria-pressed="true">all</button>
          <button class="filter-chip" data-source="chatgpt" aria-pressed="false">chatgpt</button>
          <button class="filter-chip" data-source="claude" aria-pressed="false">claude</button>
          <button class="filter-chip" data-source="codex" aria-pressed="false">codex</button>
          <button class="filter-chip" data-source="project_context" aria-pressed="false">project_context</button>
        </div>
        <div class="filters" id="topicFilters">
          <button class="filter-chip" data-topic="" aria-pressed="true">all topics</button>
          <button class="filter-chip" data-topic="workpacker" aria-pressed="false">workpacker</button>
          <button class="filter-chip" data-topic="agent_memory" aria-pressed="false">agent-memory</button>
          <button class="filter-chip" data-topic="mcp" aria-pressed="false">mcp</button>
          <button class="filter-chip" data-topic="github" aria-pressed="false">github</button>
          <button class="filter-chip" data-topic="ssen" aria-pressed="false">ssen</button>
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
          <div id="curatedReader" class="curated-grid" hidden>
            <div class="memory-card full" id="contextCard" hidden>
              <h4>context</h4>
              <div id="contextPreview" class="markdown"></div>
            </div>
            <div class="memory-card" id="summaryCard" hidden>
              <h4>summary</h4>
              <div id="summaryPreview" class="markdown"></div>
            </div>
            <div class="memory-card" id="operationalCard" hidden>
              <h4>operational memory</h4>
              <div id="operationalPreview" class="markdown"></div>
            </div>
            <div class="memory-card" id="appliesCard" hidden>
              <h4>applies to</h4>
              <div id="appliesPreview" class="markdown"></div>
            </div>
            <div class="memory-card" id="confidenceCard" hidden>
              <h4>confidence</h4>
              <div id="confidencePreview" class="markdown"></div>
            </div>
            <div class="memory-card full" id="commandsCard" hidden>
              <h4>commands / config</h4>
              <div id="commandsPreview" class="markdown"></div>
            </div>
          </div>
          <div id="contentPreview" class="markdown empty">select a memory from the library.</div>
          <details id="metadataSection" class="metadata" hidden>
            <summary>provenance</summary>
            <div id="metadataPreview" class="markdown"></div>
          </details>
          <details id="rawSourceSection" class="metadata" hidden>
            <summary>raw source</summary>
            <div id="rawSourcePreview" class="markdown"></div>
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
      view: "curated",
      source: "",
      topic: "",
      editing: false,
      metaLoaded: false,
      counts: { curated: 0, candidates: 0, rawArchive: 0, actionRequired: 0, total: 0 },
      rawSourceHtml: "",
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
        "normalized",
      ].includes(tag));
      return visible.length ? visible.slice(0, 6).map((tag) => '<span class="chip">' + escapeHtml(tag) + '</span>').join(' ') : '<span class="small">no tags</span>';
    }

    function sourceChip(source) {
      return '<span class="chip source">' + escapeHtml(source || "manual") + '</span>';
    }

    function topicChips(topics) {
      return (topics || []).length
        ? topics.map((topic) => '<span class="chip">' + escapeHtml(topic.replace("_", "-")) + '</span>').join(' ')
        : '<span class="small">no topics</span>';
    }

    function classChips(entry) {
      const chips = [];
      if (entry.tier) chips.push('<span class="chip accent">' + escapeHtml(entry.tier.replace("_", " ")) + '</span>');
      (entry.classes || []).filter((name) => ["curated_candidate", "action_required", "duplicate", "stale", "superseded"].includes(name)).forEach((name) => {
        chips.push('<span class="chip warn">' + escapeHtml(name.replace("_", " ")) + '</span>');
      });
      return chips.join(' ');
    }

    function updateFilterButtons() {
      document.querySelectorAll("#viewFilters .filter-chip").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.view === state.view ? "true" : "false");
      });
      document.querySelectorAll("#sourceFilters .filter-chip").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.source === state.source ? "true" : "false");
      });
      document.querySelectorAll("#topicFilters .filter-chip").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.topic === state.topic ? "true" : "false");
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
      state.counts = meta.counts || state.counts;
      if (!state.metaLoaded) {
        state.view = state.counts.curated > 0 ? "curated" : "all";
        state.metaLoaded = true;
      }
      updateFilterButtons();
      el("healthChip").textContent = meta.health.ok ? "healthy" : "needs attention";
      el("curatedCount").textContent = String(state.counts.curated || 0);
      el("candidateCount").textContent = String(state.counts.candidates || 0);
      el("rawCount").textContent = String(state.counts.rawArchive || 0);
      el("countLabel").textContent = "Curated: " + (state.counts.curated || 0) + " · Candidates: " + (state.counts.candidates || 0) + " · Raw archive: " + (state.counts.rawArchive || 0);
    }

    async function loadList() {
      const params = new URLSearchParams();
      if (state.query) params.set("query", state.query);
      if (state.org) params.set("org", state.org);
      if (state.view) params.set("view", state.view);
      if (state.source) params.set("source", state.source);
      if (state.topic) params.set("topic", state.topic);
      params.set("limit", "500");
      const data = await request("/api/entries?" + params.toString());
      state.entries = data.entries;
      el("countLabel").textContent = "Showing " + data.entries.length + " of " + data.total + " entries · Curated: " + (state.counts.curated || 0) + " · Candidates: " + (state.counts.candidates || 0) + " · Raw archive: " + (state.counts.rawArchive || 0);
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
          classChips(entry) +
          (entry.displayDate ? '<span>' + escapeHtml(entry.displayDate) + '</span>' : '') +
          topicChips(entry.topics) +
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
        ? sourceChip(entry.source) + ' ' + classChips(entry) + (entry.displayDate ? ' <span>' + escapeHtml(entry.displayDate) + '</span>' : '')
        : "markdown files on disk";
      el("detailTags").innerHTML = entry ? topicChips(entry.topics) : "";
      el("detailId").textContent = entry ? entry.id + " · " + entry.org : "no entry selected";
      el("linkLine").innerHTML = entry ? "" : "";
      el("editTitle").value = entry ? entry.title : "";
      el("editTags").value = entry ? (entry.tags || []).join(", ") : "";
      el("editOrg").value = entry ? entry.org : "";
      el("editBody").value = entry ? entry.body : "";
      const hasReadable = entry && (entry.contextHtml || entry.summaryHtml || entry.operationalHtml || entry.appliesToHtml || entry.confidenceHtml || entry.commandsHtml);
      el("curatedReader").hidden = !hasReadable;
      el("contextPreview").innerHTML = entry ? entry.contextHtml : "";
      el("contextCard").hidden = !entry || !entry.contextHtml;
      el("summaryPreview").innerHTML = entry ? entry.summaryHtml : "";
      el("summaryCard").hidden = !entry || !entry.summaryHtml;
      el("operationalPreview").innerHTML = entry ? entry.operationalHtml : "";
      el("operationalCard").hidden = !entry || !entry.operationalHtml;
      el("appliesPreview").innerHTML = entry ? entry.appliesToHtml : "";
      el("appliesCard").hidden = !entry || !entry.appliesToHtml;
      el("confidencePreview").innerHTML = entry ? entry.confidenceHtml : "";
      el("confidenceCard").hidden = !entry || !entry.confidenceHtml;
      el("commandsPreview").innerHTML = entry ? entry.commandsHtml : "";
      el("commandsCard").hidden = !entry || !entry.commandsHtml;
      el("contentPreview").innerHTML = entry && !hasReadable ? (entry.contentHtml || '<div class="empty">no previewable content.</div>') : "";
      el("contentPreview").hidden = Boolean(hasReadable);
      el("metadataPreview").innerHTML = entry ? entry.metadataHtml : "";
      el("metadataSection").hidden = !entry || !entry.metadataHtml;
      state.rawSourceHtml = entry ? entry.rawSourceHtml : "";
      el("rawSourcePreview").innerHTML = "";
      el("rawSourceSection").hidden = !state.rawSourceHtml;
      el("rawSourceSection").open = false;
      el("metadataSection").open = false;
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
      await loadMeta();
      await loadList();
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

    document.querySelectorAll("#viewFilters .filter-chip").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = button.dataset.view || "all";
        state.current = null;
        fillEditor(null);
        updateFilterButtons();
        loadList().catch((error) => setNotice(error.message, "error"));
      });
    });

    document.querySelectorAll("#sourceFilters .filter-chip").forEach((button) => {
      button.addEventListener("click", () => {
        state.source = button.dataset.source || "";
        state.current = null;
        fillEditor(null);
        updateFilterButtons();
        loadList().catch((error) => setNotice(error.message, "error"));
      });
    });

    document.querySelectorAll("#topicFilters .filter-chip").forEach((button) => {
      button.addEventListener("click", () => {
        state.topic = button.dataset.topic || "";
        state.current = null;
        fillEditor(null);
        updateFilterButtons();
        loadList().catch((error) => setNotice(error.message, "error"));
      });
    });

    el("rawSourceSection").addEventListener("toggle", () => {
      el("rawSourcePreview").innerHTML = el("rawSourceSection").open ? state.rawSourceHtml : "";
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
        const counts = countEntries(listResult.value.map((entry) => ({ tags: entry.tags ?? [] })));
        return json({
          root: rootDir,
          defaultOrg: orgs[0] ?? "default",
          orgs,
          count: listResult.value.length,
          counts,
          health: { ok: brokenResult.value.length === 0 },
        });
      }

      if (request.method === "GET" && url.pathname === "/api/entries") {
        const query = url.searchParams.get("query") ?? undefined;
        const org = url.searchParams.get("org") ?? undefined;
        const view = (url.searchParams.get("view") ?? "all") as EntryView;
        const source = url.searchParams.get("source") as SourceKind | null;
        const topic = url.searchParams.get("topic") as TopicKind | null;
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "500", 10);
        const result = await service.list({
          org: org || undefined,
        });

        if (result.isErr()) {
          return json({ error: result.error.message }, { status: 500 });
        }

        const entries: EntrySummary[] = [];
        for (const entry of result.value) {
          const tags = entry.tags ?? [];
          if (!matchesView(tags, view)) continue;
          const readResult = await service.read(entry.id);
          const body = readResult.isOk() ? readResult.value.body : "";
          const derived = deriveBrowserEntry(tags, body);
          const searchText = `${entry.title}\n${tags.join(" ")}\n${derived.context}\n${derived.summary}\n${derived.operational}\n${derived.appliesTo}\n${derived.metadata}`.toLowerCase();
          if (query && !searchText.includes(query.toLowerCase())) continue;
          if (source && derived.source !== source) continue;
          if (topic && !derived.topics.includes(topic)) continue;

          entries.push({
            id: entry.id,
            title: entry.title,
            tags,
            org: entry.org,
            source: derived.source,
            tier: derived.tier,
            classes: derived.classes,
            topics: derived.topics,
            excerpt: derived.excerpt,
            createdAt: derived.createdAt,
            updatedAt: derived.updatedAt,
            displayDate: derived.displayDate,
          });
        }

        entries.sort((a, b) => {
          const tierRank = (entry: EntrySummary) => entry.tier === "curated" ? 0 : entry.classes.includes("curated_candidate") ? 1 : 2;
          const rankDelta = tierRank(a) - tierRank(b);
          if (rankDelta !== 0) return rankDelta;
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
            tier: derived.tier,
            classes: derived.classes,
            topics: derived.topics,
            contextHtml: renderMarkdown(derived.context),
            summaryHtml: renderMarkdown(derived.summary),
            operationalHtml: renderMarkdown(derived.operational),
            contentHtml: renderMarkdown(derived.content),
            appliesToHtml: renderMarkdown(derived.appliesTo),
            confidenceHtml: renderMarkdown(derived.confidence),
            commandsHtml: renderMarkdown(derived.commands),
            metadataHtml: renderMarkdown(derived.metadata),
            rawSourceHtml: renderMarkdown(derived.rawSource),
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
