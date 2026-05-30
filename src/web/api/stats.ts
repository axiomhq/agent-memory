/**
 * GET /api/stats — aggregated statistics for dashboard.
 */

import type { MemoryService } from "../../service.js";
import { countEntries, inferClasses } from "../derive.js";

export interface TodoStats {
  active: number;
  done: number;
  total: number;
}

export interface StatsResponse {
  curated: number;
  archive: number;
  candidates: number;
  stale: number;
  duplicates: number;
  todos: TodoStats;
}

export function todoStats(todos: Array<{ status: string }>): TodoStats {
  const active = todos.filter((todo) => todo.status !== "done" && todo.status !== "parked").length;
  const done = todos.filter((todo) => todo.status === "done").length;
  return { active, done, total: todos.length };
}

export async function handleStatsGet(service: MemoryService, todos: TodoStats): Promise<StatsResponse> {
  const listResult = await service.list();
  if (listResult.isErr()) throw new Error(listResult.error.message);

  const counts = countEntries(listResult.value.map((entry) => ({ tags: entry.tags ?? [] })));
  return {
    curated: counts.curated,
    archive: counts.rawArchive,
    candidates: counts.candidates,
    stale: listResult.value.filter((entry) => inferClasses(entry.tags ?? []).includes("stale")).length,
    duplicates: listResult.value.filter((entry) => inferClasses(entry.tags ?? []).includes("duplicate")).length,
    todos,
  };
}
