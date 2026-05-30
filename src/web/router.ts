/**
 * Request router: dispatches to API handlers and page renderers.
 */

import type { MemoryService } from "../service.js";
import type { SourceKind, TopicKind } from "./derive.js";
import { countEntries, inferTier, deriveBrowserEntry } from "./derive.js";
import { esc } from "./markdown.js";
import {
  handleMetaGet,
} from "./api/meta.js";
import {
  handleStatsGet,
  todoStats,
} from "./api/stats.js";
import {
  isTodoStatus,
  isTodoPriority,
  normalizeTags,
  makeTodoId,
  isTodoItem,
  sortTodosForLanding,
  filterTodos,
  handleTodosGet,
  handleTodosPost,
  handleTodoComplete,
  handleTodoPriority,
  handleTodoPatch,
  type TodoStore,
  type TodoItem,
  type HandleTodosGetOptions,
  type HandleTodosPostPayload,
  type HandleTodoCompletePayload,
  type HandleTodoPriorityPayload,
  type HandleTodoPatchPayload,
} from "./api/todos.js";
import {
  handleMemoriesGet,
  handleMemoryGet,
  handleMemoryPost,
  handleMemoryPut,
  handleMemoryPromote,
  handleMemoryFlagStale,
  type HandleMemoriesGetOptions,
  type HandleMemoryPostPayload,
  type HandleMemoryPutPayload,
} from "./api/memories.js";

export interface RouterContext {
  service: MemoryService;
  rootDir: string;
  readTodoStore: (dir: string) => TodoStore;
  writeTodoStore: (dir: string, store: TodoStore) => void;
  todoStorePath: (dir: string) => string;
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

export async function handleRequest(request: Request, ctx: RouterContext): Promise<Response> {
  const url = new URL(request.url);

  try {
    // API handlers
    if (request.method === "GET" && url.pathname === "/api/meta") {
      const result = await handleMetaGet(ctx.service);
      return json(result);
    }

    if (request.method === "GET" && url.pathname === "/api/stats") {
      const todoStore = ctx.readTodoStore(ctx.rootDir);
      const todos = todoStats(todoStore.todos);
      const result = await handleStatsGet(ctx.service, todos);
      return json(result);
    }

    if (request.method === "GET" && url.pathname === "/api/todos") {
      const store = ctx.readTodoStore(ctx.rootDir);
      const status = url.searchParams.get("status");
      const sort = url.searchParams.get("sort") ?? "priority";
      const result = handleTodosGet({ store, status, sort });
      return json({
        path: ctx.todoStorePath(ctx.rootDir),
        version: result.version,
        todos: result.todos,
        stats: result.stats,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/todos") {
      const payload = await request.json().catch(() => null);
      if (!payload || typeof payload !== "object") return json({ error: "invalid JSON body" }, { status: 400 });

      const data = payload as Record<string, unknown>;
      const title = typeof data.title === "string" ? data.title.trim() : "";
      if (!title) return json({ error: "title is required" }, { status: 400 });

      const todo = handleTodosPost({
        title,
        status: data.status,
        priority: data.priority,
        sourceEntryId: data.sourceEntryId,
        sourceTitle: data.sourceTitle,
        tags: data.tags,
        notes: typeof data.notes === "string" ? data.notes : "",
      });

      const store = ctx.readTodoStore(ctx.rootDir);
      store.todos.push(todo);
      ctx.writeTodoStore(ctx.rootDir, store);
      return json({ todo }, { status: 201 });
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/todos/") && url.pathname.endsWith("/complete")) {
      const id = decodeURIComponent(url.pathname.slice("/api/todos/".length, -"/complete".length));
      const payload = await request.json().catch(() => null);
      if (!payload || typeof payload !== "object") return json({ error: "invalid JSON body" }, { status: 400 });

      const store = ctx.readTodoStore(ctx.rootDir);
      const index = store.todos.findIndex((todo) => todo.id === id);
      if (index < 0) return json({ error: "to-do not found" }, { status: 404 });

      const existing = store.todos[index];
      if (!existing) return json({ error: "to-do not found" }, { status: 404 });

      const updated = handleTodoComplete(existing, payload as HandleTodoCompletePayload);
      store.todos[index] = updated;
      ctx.writeTodoStore(ctx.rootDir, store);
      return json({ todo: updated });
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/todos/") && url.pathname.endsWith("/priority")) {
      const id = decodeURIComponent(url.pathname.slice("/api/todos/".length, -"/priority".length));
      const payload = await request.json().catch(() => null);
      if (!payload || typeof payload !== "object") return json({ error: "invalid JSON body" }, { status: 400 });

      const priority = (payload as { priority?: unknown }).priority;
      if (!isTodoPriority(priority)) return json({ error: "invalid priority" }, { status: 400 });

      const store = ctx.readTodoStore(ctx.rootDir);
      const index = store.todos.findIndex((todo) => todo.id === id);
      if (index < 0) return json({ error: "to-do not found" }, { status: 404 });

      const existing = store.todos[index];
      if (!existing) return json({ error: "to-do not found" }, { status: 404 });

      const updated = handleTodoPriority(existing, { priority });
      store.todos[index] = updated;
      ctx.writeTodoStore(ctx.rootDir, store);
      return json({ todo: updated });
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/todos/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/todos/".length));
      const payload = await request.json().catch(() => null);
      if (!payload || typeof payload !== "object") return json({ error: "invalid JSON body" }, { status: 400 });

      const store = ctx.readTodoStore(ctx.rootDir);
      const index = store.todos.findIndex((todo) => todo.id === id);
      if (index < 0) return json({ error: "to-do not found" }, { status: 404 });

      const existing = store.todos[index];
      if (!existing) return json({ error: "to-do not found" }, { status: 404 });

      try {
        const updated = handleTodoPatch(existing, payload as HandleTodoPatchPayload);
        store.todos[index] = updated;
        ctx.writeTodoStore(ctx.rootDir, store);
        return json({ todo: updated });
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed to update to-do";
        return json({ error: message }, { status: 400 });
      }
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/todos/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/todos/".length));
      const store = ctx.readTodoStore(ctx.rootDir);
      const nextTodos = store.todos.filter((todo) => todo.id !== id);
      if (nextTodos.length === store.todos.length) return json({ error: "to-do not found" }, { status: 404 });
      ctx.writeTodoStore(ctx.rootDir, { ...store, todos: nextTodos });
      return text("deleted");
    }

    if (request.method === "GET" && url.pathname === "/api/memories") {
      const query = url.searchParams.get("search") ?? url.searchParams.get("query") ?? undefined;
      const org = url.searchParams.get("org") ?? undefined;
      const tier = url.searchParams.get("tier") ?? undefined;
      const classFilter = url.searchParams.get("class") ?? undefined;
      const source = url.searchParams.get("source") as SourceKind | null;
      const topic = url.searchParams.get("topic") as TopicKind | null;
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
      const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);

      const result = await handleMemoriesGet({
        service: ctx.service,
        query,
        org: org || undefined,
        tier,
        classFilter,
        source,
        topic,
        limit,
        offset,
      });
      return json(result);
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/memories/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/memories/".length));
      const result = await handleMemoryGet(ctx.service, id);
      return json(result);
    }

    if (request.method === "POST" && url.pathname === "/api/memories") {
      const payload = await request.json().catch(() => null);
      if (!payload || typeof payload !== "object") return json({ error: "invalid JSON body" }, { status: 400 });

      try {
        const result = await handleMemoryPost(ctx.service, payload as HandleMemoryPostPayload);
        return json(result, { status: 201 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed to create memory";
        return json({ error: message }, { status: 400 });
      }
    }

    if (request.method === "PUT" && url.pathname.startsWith("/api/memories/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/memories/".length));
      const payload = await request.json().catch(() => null);
      if (!payload || typeof payload !== "object") return json({ error: "invalid JSON body" }, { status: 400 });

      try {
        const result = await handleMemoryPut(ctx.service, id, payload as HandleMemoryPutPayload);
        return json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed to update memory";
        return json({ error: message }, { status: 500 });
      }
    }

    if (request.method === "POST" && url.pathname.endsWith("/promote") && url.pathname.startsWith("/api/memories/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/memories/".length, -"/promote".length));
      try {
        const result = await handleMemoryPromote(ctx.service, id);
        return json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed to promote memory";
        return json({ error: message }, { status: 500 });
      }
    }

    if (request.method === "POST" && url.pathname.endsWith("/flag-stale") && url.pathname.startsWith("/api/memories/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/memories/".length, -"/flag-stale".length));
      try {
        const result = await handleMemoryFlagStale(ctx.service, id);
        return json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed to flag memory";
        return json({ error: message }, { status: 500 });
      }
    }

    return new Response("not found", { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal server error";
    return json({ error: message }, { status: 500 });
  }
}
