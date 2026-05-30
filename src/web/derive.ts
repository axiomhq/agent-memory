/**
 * Data derivation layer: pure functions for classification, filtering, and memory analysis.
 * No HTML rendering or HTTP handling here.
 */

import type { MemoryService } from "../service.js";

export type SourceKind = "chatgpt" | "claude" | "codex" | "project_context" | "manual" | "unknown";
export type EntryTier = "curated" | "raw_archive" | "unknown";
export type EntryView = "curated" | "candidates" | "raw" | "action" | "all";
export type EntryClass =
  | "raw_import"
  | "curated"
  | "curated_candidate"
  | "duplicate"
  | "stale"
  | "superseded"
  | "action_required"
  | "project_context";
export type TopicKind = "workpacker" | "agent_memory" | "mcp" | "github" | "ssen" | "infra";

export interface EntrySummary {
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

export interface BrowserDerivedEntry {
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

export interface StoreCounts {
  curated: number;
  candidates: number;
  rawArchive: number;
  actionRequired: number;
  total: number;
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

export function shorten(body: string, length = 180): string {
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

export function displayDate(value: string | null): string | null {
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

export function inferSource(tags: string[], body: string): SourceKind {
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

export function inferTier(tags: string[]): EntryTier {
  if (tags.includes("tier__curated")) return "curated";
  if (tags.includes("tier__raw_archive")) return "raw_archive";
  if (tags.includes("curated")) return "curated";
  return "unknown";
}

export function inferClasses(tags: string[]): EntryClass[] {
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

export function inferTopics(tags: string[]): TopicKind[] {
  return [...new Set(tags
    .filter((tag) => tag.startsWith("topic__"))
    .map((tag) => tag.replace(/^topic__/, ""))
    .filter((tag): tag is TopicKind =>
      ["workpacker", "agent_memory", "mcp", "github", "ssen", "infra"].includes(tag)
    ))];
}

export function countEntries(entries: Array<{ tags: string[] }>): StoreCounts {
  return {
    curated: entries.filter((entry) => inferTier(entry.tags) === "curated").length,
    candidates: entries.filter((entry) => inferClasses(entry.tags).includes("curated_candidate")).length,
    rawArchive: entries.filter((entry) => inferTier(entry.tags) === "raw_archive").length,
    actionRequired: entries.filter((entry) => inferClasses(entry.tags).includes("action_required")).length,
    total: entries.length,
  };
}

export function matchesView(tags: string[], view: EntryView): boolean {
  const tier = inferTier(tags);
  const classes = inferClasses(tags);
  if (view === "curated") return tier === "curated";
  if (view === "candidates") return classes.includes("curated_candidate");
  if (view === "raw") return tier === "raw_archive";
  if (view === "action") return classes.includes("action_required");
  return true;
}

export function deriveBrowserEntry(tags: string[], body: string): BrowserDerivedEntry {
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

export interface ListMemoriesFilter {
  org?: string;
  query?: string;
  view?: EntryView;
  source?: SourceKind;
  topic?: TopicKind;
  limit?: number;
  offset?: number;
}

export async function listMemories(service: MemoryService, filters: ListMemoriesFilter): Promise<{
  memories: EntrySummary[];
  total: number;
  filtered: number;
}> {
  const result = await service.list({ org: filters.org });
  if (result.isErr()) throw new Error(result.error.message);

  const memories: EntrySummary[] = [];
  for (const entry of result.value) {
    const tags = entry.tags ?? [];
    if (filters.view && !matchesView(tags, filters.view)) continue;

    const readResult = await service.read(entry.id);
    const body = readResult.isOk() ? readResult.value.body : "";
    const derived = deriveBrowserEntry(tags, body);

    const searchText = `${entry.title}\n${tags.join(" ")}\n${derived.context}\n${derived.summary}\n${derived.operational}\n${derived.appliesTo}\n${derived.metadata}`.toLowerCase();
    if (filters.query && !searchText.includes(filters.query.toLowerCase())) continue;
    if (filters.source && derived.source !== filters.source) continue;
    if (filters.topic && !derived.topics.includes(filters.topic)) continue;

    memories.push({
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

  memories.sort((a, b) => {
    const aDate = a.updatedAt ?? a.createdAt;
    const bDate = b.updatedAt ?? b.createdAt;
    if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    return a.title.localeCompare(b.title);
  });

  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 50;

  return {
    memories: memories.slice(offset, offset + limit),
    total: result.value.length,
    filtered: memories.length,
  };
}
