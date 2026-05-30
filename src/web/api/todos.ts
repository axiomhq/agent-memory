/**
 * TODO API handlers: GET, POST, PATCH, DELETE, complete, priority.
 */

export type TodoStatus = "open" | "doing" | "blocked" | "done" | "parked";
export type TodoPriority = "low" | "normal" | "high";

export interface TodoItem {
  id: string;
  title: string;
  status: TodoStatus;
  priority: TodoPriority;
  sourceEntryId?: string;
  sourceTitle?: string;
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TodoStore {
  version: 1;
  todos: TodoItem[];
}

const TODO_STATUSES: TodoStatus[] = ["open", "doing", "blocked", "done", "parked"];
const TODO_PRIORITIES: TodoPriority[] = ["low", "normal", "high"];

export function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && TODO_STATUSES.includes(value as TodoStatus);
}

export function isTodoPriority(value: unknown): value is TodoPriority {
  return typeof value === "string" && TODO_PRIORITIES.includes(value as TodoPriority);
}

export function normalizeTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean)
    : [];
}

export function makeTodoId(): string {
  return `todo_${crypto.randomUUID().slice(0, 8)}`;
}

export function isTodoItem(value: unknown): value is TodoItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Record<keyof TodoItem, unknown>>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    isTodoStatus(item.status) &&
    isTodoPriority(item.priority) &&
    Array.isArray(item.tags) &&
    item.tags.every((tag) => typeof tag === "string") &&
    typeof item.notes === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    (item.completedAt === undefined || typeof item.completedAt === "string") &&
    (item.sourceEntryId === undefined || typeof item.sourceEntryId === "string") &&
    (item.sourceTitle === undefined || typeof item.sourceTitle === "string")
  );
}

function todoIsActive(todo: TodoItem): boolean {
  return todo.status !== "done" && todo.status !== "parked";
}

function priorityRank(priority: TodoPriority): number {
  if (priority === "high") return 0;
  if (priority === "normal") return 1;
  return 2;
}

export function sortTodosForLanding(todos: TodoItem[]): TodoItem[] {
  return [...todos].sort((a, b) => {
    const priorityDelta = priorityRank(a.priority) - priorityRank(b.priority);
    if (priorityDelta !== 0) return priorityDelta;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function filterTodos(todos: TodoItem[], status: string | null): TodoItem[] {
  if (!status || status === "active") return todos.filter(todoIsActive);
  if (status === "all") return todos;
  if (status === "done") return todos.filter((todo) => todo.status === "done");
  if (isTodoStatus(status)) return todos.filter((todo) => todo.status === status);
  return todos.filter(todoIsActive);
}

export interface HandleTodosGetOptions {
  store: TodoStore;
  status: string | null;
  sort: string;
}

export function handleTodosGet(options: HandleTodosGetOptions): TodoStore & { stats: { active: number; done: number; total: number } } {
  const todos = filterTodos(options.store.todos, options.status);
  const sortedTodos = options.sort === "created"
    ? [...todos].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : options.sort === "modified"
      ? [...todos].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      : sortTodosForLanding(todos);

  const stats = {
    active: options.store.todos.filter(todoIsActive).length,
    done: options.store.todos.filter((todo) => todo.status === "done").length,
    total: options.store.todos.length,
  };

  return {
    ...options.store,
    todos: sortedTodos,
    stats,
  };
}

export interface HandleTodosPostPayload {
  title: string;
  status?: unknown;
  priority?: unknown;
  sourceEntryId?: unknown;
  sourceTitle?: unknown;
  tags?: unknown;
  notes?: string;
}

export function handleTodosPost(payload: HandleTodosPostPayload): TodoItem {
  const now = new Date().toISOString();
  const status = isTodoStatus(payload.status) ? payload.status : "open";
  const todo: TodoItem = {
    id: makeTodoId(),
    title: payload.title,
    status,
    priority: isTodoPriority(payload.priority) ? payload.priority : "normal",
    sourceEntryId: typeof payload.sourceEntryId === "string" && payload.sourceEntryId.trim() ? payload.sourceEntryId.trim() : undefined,
    sourceTitle: typeof payload.sourceTitle === "string" && payload.sourceTitle.trim() ? payload.sourceTitle.trim() : undefined,
    tags: normalizeTags(payload.tags),
    notes: typeof payload.notes === "string" ? payload.notes : "",
    createdAt: now,
    updatedAt: now,
    completedAt: status === "done" ? now : undefined,
  };
  return todo;
}

export interface HandleTodoCompletePayload {
  isDone?: unknown;
}

export function handleTodoComplete(existing: TodoItem, payload: HandleTodoCompletePayload): TodoItem {
  const isDone = Boolean(payload.isDone);
  const now = new Date().toISOString();
  return {
    ...existing,
    status: isDone ? "done" : "open",
    updatedAt: now,
    completedAt: isDone ? existing.completedAt ?? now : undefined,
  };
}

export interface HandleTodoPriorityPayload {
  priority?: unknown;
}

export function handleTodoPriority(existing: TodoItem, payload: HandleTodoPriorityPayload): TodoItem {
  return {
    ...existing,
    priority: payload.priority as TodoPriority,
    updatedAt: new Date().toISOString(),
  };
}

export interface HandleTodoPatchPayload {
  title?: unknown;
  status?: unknown;
  priority?: unknown;
  sourceEntryId?: unknown;
  sourceTitle?: unknown;
  tags?: unknown;
  notes?: unknown;
}

export function handleTodoPatch(existing: TodoItem, payload: HandleTodoPatchPayload): TodoItem {
  const nextStatus = payload.status === undefined ? existing.status : isTodoStatus(payload.status) ? payload.status : null;
  const nextPriority = payload.priority === undefined ? existing.priority : isTodoPriority(payload.priority) ? payload.priority : null;
  if (!nextStatus || !nextPriority) throw new Error("invalid status or priority");

  const title = payload.title === undefined ? existing.title : typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) throw new Error("title is required");

  const now = new Date().toISOString();
  return {
    ...existing,
    title,
    status: nextStatus,
    priority: nextPriority,
    sourceEntryId: payload.sourceEntryId === undefined ? existing.sourceEntryId : typeof payload.sourceEntryId === "string" && payload.sourceEntryId.trim() ? payload.sourceEntryId.trim() : undefined,
    sourceTitle: payload.sourceTitle === undefined ? existing.sourceTitle : typeof payload.sourceTitle === "string" && payload.sourceTitle.trim() ? payload.sourceTitle.trim() : undefined,
    tags: payload.tags === undefined ? existing.tags : normalizeTags(payload.tags),
    notes: payload.notes === undefined ? existing.notes : typeof payload.notes === "string" ? payload.notes : existing.notes,
    updatedAt: now,
    completedAt: nextStatus === "done" ? existing.completedAt ?? now : undefined,
  };
}
