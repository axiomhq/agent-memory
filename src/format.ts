/**
 * memory entry serialization.
 * markdown files with JSON metadata in an HTML comment header.
 */

import { ok, err, type Result } from "neverthrow";
import { type } from "arktype";
import { MemoryEntryMetaSchema, type MemoryEntryMeta, type MemoryEntry } from "./schema.js";

const HEADER_START = "<!-- agent-memory:meta";
const HEADER_END = "-->";

export type FormatError = { _tag: "format.parse"; path: string; message: string };

export function serializeMemoryMarkdown(meta: MemoryEntryMeta, body: string): string {
  const json = JSON.stringify(meta, null, 2).replaceAll("-->", "--\\u003E");
  const header = `${HEADER_START}\n${json}\n${HEADER_END}`;
  return `${header}\n\n${body}\n`;
}

export function parseMemoryMarkdown(
  text: string,
  sourcePath: string,
): Result<MemoryEntry, FormatError> {
  const startIdx = text.indexOf(HEADER_START);
  if (startIdx === -1) {
    return err({
      _tag: "format.parse",
      path: sourcePath,
      message: "missing memory metadata header",
    });
  }

  const jsonStart = startIdx + HEADER_START.length;
  const endIdx = text.indexOf(HEADER_END, jsonStart);
  if (endIdx === -1) {
    return err({
      _tag: "format.parse",
      path: sourcePath,
      message: "unterminated memory metadata header",
    });
  }

  const jsonStr = text.slice(jsonStart, endIdx).trim().replaceAll("--\\u003E", "-->");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return err({
      _tag: "format.parse",
      path: sourcePath,
      message: `invalid JSON in metadata header: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const validated = MemoryEntryMetaSchema(parsed);
  if (validated instanceof type.errors) {
    return err({
      _tag: "format.parse",
      path: sourcePath,
      message: `schema validation failed: ${validated.summary}`,
    });
  }

  const body = text.slice(endIdx + HEADER_END.length).replace(/^\n+/, "");

  return ok({ meta: validated, body });
}
