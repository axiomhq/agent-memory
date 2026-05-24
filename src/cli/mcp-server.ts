/**
 * memory mcp-server — exposes the local memory store over stdio MCP.
 */

import { Buffer } from "buffer";
import { join } from "path";
import { loadConfig, expandPath } from "../config.js";
import { createFileMemoryPersistenceAdapter } from "../persist/filesystem.js";
import { createMemoryService } from "../service.js";
import { writeJournalEntry } from "../journal.js";
import type { JournalQueueEntry } from "../schema.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface McpToolCallArgs {
  query?: string;
  limit?: number;
  id?: string;
  subject?: string;
  content?: string;
  tag?: string[];
  harness?: JournalQueueEntry["harness"];
}

const PROTOCOL_VERSION = "2024-11-05";
type TransportMode = "auto" | "framed" | "raw";

function createMemoryApi() {
  const config = loadConfig();
  const rootDir = expandPath(config.storage.root);
  const inboxDir = join(rootDir, "inbox");
  const adapter = createFileMemoryPersistenceAdapter({ rootDir });
  const service = createMemoryService(adapter);

  return { rootDir, inboxDir, service };
}

function toolList() {
  return {
    tools: [
      {
        name: "memory_list",
        description: "List memory entries in the primary store, optionally filtered by query.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number", minimum: 1 },
          },
          additionalProperties: false,
        },
      },
      {
        name: "memory_search",
        description: "Search memory entries by query.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number", minimum: 1 },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "memory_read",
        description: "Read a memory entry by id.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
          additionalProperties: false,
        },
      },
      {
        name: "memory_capture",
        description: "Capture a new journal entry into the primary store inbox.",
        inputSchema: {
          type: "object",
          properties: {
            subject: { type: "string" },
            content: { type: "string" },
            tag: {
              type: "array",
              items: { type: "string" },
            },
            harness: {
              type: "string",
              enum: ["amp", "pi", "codex", "manual"],
            },
          },
          required: ["subject", "content"],
          additionalProperties: false,
        },
      },
    ],
  };
}

function asText(text: string) {
  return [{ type: "text", text }];
}

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function parseFramedMessage(buffer: Buffer): { message: string; rest: Buffer } | null {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) return null;

  const headerText = buffer.slice(0, headerEnd).toString("utf8");
  const match = headerText.match(/content-length:\s*(\d+)/i);
  if (!match) {
    throw new Error("invalid MCP frame: missing Content-Length");
  }

  const length = Number(match[1]);
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + length;
  if (buffer.length < bodyEnd) return null;

  const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
  return { message: body, rest: buffer.slice(bodyEnd) };
}

function parseRawMessage(buffer: Buffer): { message: string; rest: Buffer } | null {
  const text = buffer.toString("utf8");
  const start = text.search(/\S/);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth++;
      continue;
    }

    if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) {
        const end = index + 1;
        return {
          message: text.slice(start, end).trim(),
          rest: buffer.slice(Buffer.byteLength(text.slice(0, end), "utf8")),
        };
      }
    }
  }

  const newlineIndex = buffer.indexOf("\n");
  if (newlineIndex === -1) return null;

  const line = buffer.slice(0, newlineIndex).toString("utf8").trim();
  const rest = buffer.slice(newlineIndex + 1);
  return { message: line, rest };
}

function writeMessage(message: JsonRpcResponse | Record<string, unknown>, mode: TransportMode) {
  const json = JSON.stringify(message);
  if (mode === "raw") {
    process.stdout.write(`${json}\n`);
    return;
  }

  const payload = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
  process.stdout.write(payload);
}

async function handleToolCall(
  name: string,
  args: McpToolCallArgs,
): Promise<unknown> {
  const { service, inboxDir } = createMemoryApi();

  if (name === "memory_list") {
    const result = await service.list({
      query: args.query,
      limit: args.limit,
    });

    if (result.isErr()) {
      throw new Error(result.error.message);
    }

    if (result.value.length === 0) {
      return { content: asText("no entries found") };
    }

    const lines = result.value.map((entry) => {
      const tags = entry.tags?.length ? ` [${entry.tags.join(", ")}]` : "";
      return `${entry.id}: "${entry.title}"${tags}`;
    });

    return { content: asText(lines.join("\n")) };
  }

  if (name === "memory_search") {
    if (!args.query) {
      throw new Error("missing required argument: query");
    }

    const result = await service.list({
      query: args.query,
      limit: args.limit,
    });

    if (result.isErr()) {
      throw new Error(result.error.message);
    }

    if (result.value.length === 0) {
      return { content: asText("no entries found") };
    }

    const lines = result.value.map((entry) => {
      const tags = entry.tags?.length ? ` [${entry.tags.join(", ")}]` : "";
      return `${entry.id}: "${entry.title}"${tags}`;
    });

    return { content: asText(lines.join("\n")) };
  }

  if (name === "memory_read") {
    if (!args.id) {
      throw new Error("missing required argument: id");
    }

    const result = await service.read(args.id);
    if (result.isErr()) {
      throw new Error(result.error.message);
    }

    const entry = result.value;
    const tags = entry.meta.tags?.length ? ` [${entry.meta.tags.join(", ")}]` : "";
    return {
      content: asText([
        "---",
        `id: ${entry.meta.id}`,
        `title: ${entry.meta.title}${tags}`,
        "---",
        "",
        entry.body,
      ].join("\n")),
    };
  }

  if (name === "memory_capture") {
    if (!args.subject || !args.content) {
      throw new Error("missing required arguments: subject, content");
    }

    const entry: JournalQueueEntry = {
      version: "1",
      timestamp: new Date().toISOString(),
      harness: args.harness ?? "manual",
      retrieval: {
        method: "file",
        content: args.content,
      },
      context: {
        cwd: process.cwd(),
      },
    };

    const result = writeJournalEntry(entry, { inboxDir });
    if (result.isErr()) {
      throw new Error(result.error.message);
    }

    return {
      content: asText(`captured: ${result.value}`),
    };
  }

  throw new Error(`unknown tool: ${name}`);
}

async function handleRequest(request: JsonRpcRequest) {
  const { id, method, params } = request;

  if (method === "initialize") {
    const raw = (params ?? {}) as { protocolVersion?: string };
    return ok(id ?? null, {
      protocolVersion: raw.protocolVersion ?? PROTOCOL_VERSION,
      serverInfo: {
        name: "agent-memory",
        version: "0.1.0",
      },
      capabilities: {
        tools: { listChanged: false },
        resources: {},
        prompts: {},
      },
    });
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }

  if (method === "ping") {
    return ok(id ?? null, {});
  }

  if (method === "tools/list") {
    return ok(id ?? null, toolList());
  }

  if (method === "resources/list") {
    return ok(id ?? null, { resources: [] });
  }

  if (method === "resources/templates/list") {
    return ok(id ?? null, { resourceTemplates: [] });
  }

  if (method === "prompts/list") {
    return ok(id ?? null, { prompts: [] });
  }

  if (method === "tools/call") {
    const raw = (params ?? {}) as { name?: string; arguments?: unknown };
    const args = (raw.arguments ?? {}) as McpToolCallArgs;

    if (!raw.name) {
      return fail(id ?? null, -32602, "missing required parameter: name");
    }

    try {
      return ok(id ?? null, await handleToolCall(raw.name, args));
    } catch (error) {
      return fail(
        id ?? null,
        -32000,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return fail(id ?? null, -32601, `method not found: ${method}`);
}

export async function run(_args: string[] = []) {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0) as Buffer<ArrayBufferLike>;
  let transportMode: TransportMode = "auto";

  const stdin = process.stdin;
  stdin.resume();

  for await (const chunk of stdin as AsyncIterable<Buffer | string>) {
    const chunkBuffer: Buffer<ArrayBufferLike> = Buffer.isBuffer(chunk)
      ? (Buffer.from(chunk) as Buffer<ArrayBufferLike>)
      : (Buffer.from(chunk) as Buffer<ArrayBufferLike>);
    buffer = Buffer.concat([buffer, chunkBuffer]);

    while (true) {
      let parsed: { message: string; rest: Buffer } | null = null;

      if (transportMode === "framed") {
        parsed = parseFramedMessage(buffer);
      } else if (transportMode === "raw") {
        parsed = parseRawMessage(buffer);
      } else {
        parsed = parseFramedMessage(buffer);
        if (parsed) {
          transportMode = "framed";
        } else {
          parsed = parseRawMessage(buffer);
          if (parsed) {
            transportMode = "raw";
          }
        }
      }

      if (!parsed) break;

      if (!parsed.message) {
        buffer = parsed.rest;
        continue;
      }

      buffer = parsed.rest;
      try {
        const request = JSON.parse(parsed.message) as JsonRpcRequest;
        const response = await handleRequest(request);
        if (response) {
          writeMessage(response, transportMode === "auto" ? "framed" : transportMode);
        }
      } catch (error) {
        writeMessage(
          fail(
            null,
            -32700,
            error instanceof Error ? error.message : String(error),
          ),
          transportMode === "auto" ? "framed" : transportMode,
        );
      }
    }
  }
}
