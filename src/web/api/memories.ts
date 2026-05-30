/**
 * Memory API handlers: GET list, GET detail, POST create, PUT update, promotion/flagging.
 */

import type { MemoryService } from "../../service.js";
import type { EntrySummary, SourceKind, TopicKind } from "../derive.js";
import { deriveBrowserEntry, displayDate } from "../derive.js";
import { renderMarkdown } from "../markdown.js";

export interface ApiEntry {
  id: string;
  title: string;
  tags: string[];
  org: string;
  body: string;
  source: SourceKind;
  tier: "curated" | "raw_archive" | "unknown";
  classes: string[];
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
}

export interface HandleMemoriesGetOptions {
  service: MemoryService;
  query?: string;
  org?: string;
  tier?: string;
  classFilter?: string;
  source?: SourceKind | null;
  topic?: TopicKind | null;
  limit: number;
  offset: number;
}

export async function handleMemoriesGet(options: HandleMemoriesGetOptions): Promise<{
  memories: EntrySummary[];
  total: number;
  filtered: number;
  limit: number;
  offset: number;
}> {
  const result = await options.service.list({ org: options.org });
  if (result.isErr()) throw new Error(result.error.message);

  const memories: EntrySummary[] = [];
  for (const entry of result.value) {
    const tags = entry.tags ?? [];
    const readResult = await options.service.read(entry.id);
    const body = readResult.isOk() ? readResult.value.body : "";
    const derived = deriveBrowserEntry(tags, body);
    const searchText = `${entry.title}\n${tags.join(" ")}\n${derived.context}\n${derived.summary}\n${derived.operational}\n${derived.appliesTo}\n${derived.metadata}`.toLowerCase();
    if (options.query && !searchText.includes(options.query.toLowerCase())) continue;
    if (options.tier === "curated" && derived.tier !== "curated") continue;
    if (options.tier === "raw_archive" && derived.tier !== "raw_archive") continue;
    if (options.classFilter && !derived.classes.includes(options.classFilter as any)) continue;
    if (options.source && derived.source !== options.source) continue;
    if (options.topic && !derived.topics.includes(options.topic)) continue;

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

  return {
    memories: memories.slice(options.offset, options.offset + options.limit),
    total: result.value.length,
    filtered: memories.length,
    limit: options.limit,
    offset: options.offset,
  };
}

export async function handleMemoryGet(service: MemoryService, id: string): Promise<{ memory: ApiEntry }> {
  const entryResult = await service.read(id);
  if (entryResult.isErr()) throw new Error(entryResult.error.message);

  const derived = deriveBrowserEntry(entryResult.value.meta.tags ?? [], entryResult.value.body);
  return {
    memory: {
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
  };
}

export interface HandleMemoryPostPayload {
  title?: unknown;
  body?: unknown;
  org?: unknown;
  tags?: unknown;
}

export async function handleMemoryPost(service: MemoryService, payload: HandleMemoryPostPayload): Promise<{ memory: { meta: any; body: string } }> {
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  const org = typeof payload.org === "string" && payload.org.trim() ? payload.org.trim() : "default";
  const tags = Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean) : [];
  if (!title || !body) throw new Error("title and body are required");

  const result = await service.capture({ title, body, tags, org });
  if (result.isErr()) throw new Error(result.error.message);

  return { memory: { meta: result.value.meta, body: result.value.body } };
}

export interface HandleMemoryPutPayload {
  title?: unknown;
  body?: unknown;
  tags?: unknown;
}

export async function handleMemoryPut(service: MemoryService, id: string, payload: HandleMemoryPutPayload): Promise<{ ok: boolean }> {
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body : null;
  const tags = Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean) : null;

  if (body !== null) {
    const bodyResult = await service.updateBody(id, body);
    if (bodyResult.isErr()) throw new Error(bodyResult.error.message);
  }

  if (title || tags) {
    const metaResult = await service.updateMeta(id, {
      ...(title ? { title } : {}),
      ...(tags ? { tags } : {}),
    });
    if (metaResult.isErr()) throw new Error(metaResult.error.message);
  }

  return { ok: true };
}

function appendTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags : [...tags, tag];
}

export async function handleMemoryPromote(service: MemoryService, id: string): Promise<{ ok: boolean; tags: string[] }> {
  const entryResult = await service.read(id);
  if (entryResult.isErr()) throw new Error(entryResult.error.message);

  const nextTags = appendTag(entryResult.value.meta.tags ?? [], "tier__curated").filter((tag) => tag !== "tier__raw_archive");
  const metaResult = await service.updateMeta(id, { tags: nextTags });
  if (metaResult.isErr()) throw new Error(metaResult.error.message);

  return { ok: true, tags: nextTags };
}

export async function handleMemoryFlagStale(service: MemoryService, id: string): Promise<{ ok: boolean; tags: string[] }> {
  const entryResult = await service.read(id);
  if (entryResult.isErr()) throw new Error(entryResult.error.message);

  const nextTags = appendTag(entryResult.value.meta.tags ?? [], "class__stale");
  const metaResult = await service.updateMeta(id, { tags: nextTags });
  if (metaResult.isErr()) throw new Error(metaResult.error.message);

  return { ok: true, tags: nextTags };
}
