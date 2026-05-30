/**
 * GET /api/meta — workspace metadata and health check.
 */

import type { MemoryService } from "../../service.js";
import { countEntries } from "../derive.js";

export async function handleMetaGet(service: MemoryService): Promise<{
  root: string;
  defaultOrg: string;
  orgs: string[];
  count: number;
  counts: ReturnType<typeof countEntries>;
  health: { ok: boolean };
}> {
  const [listResult, brokenResult] = await Promise.all([
    service.list(),
    service.brokenLinks(),
  ]);

  if (listResult.isErr()) throw new Error(listResult.error.message);
  if (brokenResult.isErr()) throw new Error(brokenResult.error.message);

  const orgs = [...new Set(listResult.value.map((entry) => entry.org))].sort();
  const counts = countEntries(listResult.value.map((entry) => ({ tags: entry.tags ?? [] })));
  return {
    root: process.cwd(),
    defaultOrg: orgs[0] ?? "default",
    orgs,
    count: listResult.value.length,
    counts,
    health: { ok: brokenResult.value.length === 0 },
  };
}
