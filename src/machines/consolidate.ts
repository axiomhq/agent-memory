/**
 * consolidation machine — drains journal queue, invokes LLM, routes to memory.
 *
 * per WORKFLOW = DATA: the machine is a record with state, not a running process.
 * per INJECT AT THE BOUNDARY: adapters injected via machine.provide().
 *
 * states: loadQueue → fetchHistory → runAgent → parseOutput → writeEntries → markProcessed → commitChanges → completed | failed
 */

import { setup, assign, fromPromise } from "xstate";
import { parseConsolidationOutput } from "../prompts/consolidate.js";
import type { JournalForPrompt, ExistingEntryRef, ParsedKbEntry } from "../prompts/consolidate.js";

export interface ConsolidateError {
  _tag: string;
  message: string;
}

export interface ConsolidateContext {
  limit: number;
  queueEntries: Array<{ id: string; entry: unknown }>;
  historyContent: string;
  journals: JournalForPrompt[];
  existingEntries: ExistingEntryRef[];
  agentOutput: string;
  parsedEntries: ParsedKbEntry[];
  parseError?: string;
  writtenEntries: Array<{ id: string; title: string; body: string }>;
  processedCount: number;
  failedQueueIds: string[];
  error?: ConsolidateError;
}

export interface ConsolidateInput {
  limit: number;
}

const loadQueueActor = fromPromise<
  { entries: Array<{ id: string; entry: unknown }>; journals: JournalForPrompt[] },
  { limit: number }
>(async () => {
  throw new Error("loadQueue: not provided via machine.provide()");
});

const fetchHistoryActor = fromPromise<
  string,
  { entries: Array<{ id: string; entry: unknown }> }
>(async () => {
  throw new Error("fetchHistory: not provided via machine.provide()");
});

const listExistingActor = fromPromise<ExistingEntryRef[], void>(async () => {
  throw new Error("listExisting: not provided via machine.provide()");
});

const runAgentActor = fromPromise<
  string,
  { journals: JournalForPrompt[]; existingEntries: ExistingEntryRef[]; historyContent: string }
>(async () => {
  throw new Error("runAgent: not provided via machine.provide()");
});

const writeEntriesActor = fromPromise<
  Array<{ id: string; title: string; body: string }>,
  { entries: ParsedKbEntry[] }
>(async () => {
  throw new Error("writeEntries: not provided via machine.provide()");
});

const markProcessedActor = fromPromise<
  { count: number; failedIds: string[] },
  { queueIds: string[]; kbIds: string[] }
>(async () => {
  throw new Error("markProcessed: not provided via machine.provide()");
});

const commitChangesActor = fromPromise<void, { entryCount: number; queueCount: number }>(
  async () => {
    throw new Error("commitChanges: not provided via machine.provide()");
  },
);

export const consolidateMachine = setup({
  types: {
    context: {} as ConsolidateContext,
    input: {} as ConsolidateInput,
  },
  actors: {
    loadQueue: loadQueueActor,
    fetchHistory: fetchHistoryActor,
    listExisting: listExistingActor,
    runAgent: runAgentActor,
    writeEntries: writeEntriesActor,
    markProcessed: markProcessedActor,
    commitChanges: commitChangesActor,
  },
  actions: {
    assignQueueEntries: assign({
      queueEntries: (_, params: { entries: Array<{ id: string; entry: unknown }> }) =>
        params.entries,
    }),
    assignJournals: assign({
      journals: (_, params: { journals: JournalForPrompt[] }) => params.journals,
    }),
    assignHistoryContent: assign({
      historyContent: (_, params: { content: string }) => params.content,
    }),
    assignAgentOutput: assign({
      agentOutput: (_, params: { output: string }) => params.output,
    }),
    assignParsedEntries: assign({
      parsedEntries: (_, params: { entries: ParsedKbEntry[] }) => params.entries,
    }),
    assignParseError: assign({
      parseError: (_, params: { message: string }) => params.message,
    }),
    assignWrittenEntries: assign({
      writtenEntries: (_, params: { entries: Array<{ id: string; title: string; body: string }> }) =>
        params.entries,
    }),
    assignProcessedCount: assign({
      processedCount: (_, params: { count: number; failedIds: string[] }) => params.count,
      failedQueueIds: (_, params: { count: number; failedIds: string[] }) => params.failedIds,
    }),
    assignExistingEntries: assign({
      existingEntries: (_, params: { entries: ExistingEntryRef[] }) => params.entries,
    }),
    assignError: assign({
      error: (_, params: { _tag: string; message: string }) => ({
        _tag: params._tag,
        message: params.message,
      }),
    }),
  },
  guards: {
    hasQueueEntries: (_, params: { entries: Array<{ id: string; entry: unknown }> }) =>
      params.entries.length > 0,
    hasEntries: ({ context }) => context.parsedEntries.length > 0,
    hasParseError: ({ context }) => context.parseError !== undefined,
  },
}).createMachine({
  id: "consolidate",
  initial: "loadQueue",
  context: ({ input }) => ({
    limit: input.limit,
    queueEntries: [],
    historyContent: "",
    journals: [],
    existingEntries: [],
    agentOutput: "",
    parsedEntries: [],
    writtenEntries: [],
    processedCount: 0,
    failedQueueIds: [],
  }),

  states: {
    loadQueue: {
      invoke: {
        id: "loadQueue",
        src: "loadQueue",
        input: ({ context }) => ({ limit: context.limit }),
        onDone: [
          {
            guard: {
              type: "hasQueueEntries",
              params: ({ event }) => ({ entries: event.output.entries }),
            },
            target: "fetchHistory",
            actions: [
              {
                type: "assignQueueEntries",
                params: ({ event }) => ({ entries: event.output.entries }),
              },
              {
                type: "assignJournals",
                params: ({ event }) => ({ journals: event.output.journals }),
              },
            ],
          },
          {
            target: "completed",
            actions: [
              {
                type: "assignQueueEntries",
                params: ({ event }) => ({ entries: event.output.entries }),
              },
              {
                type: "assignJournals",
                params: ({ event }) => ({ journals: event.output.journals }),
              },
            ],
          },
        ],
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "consolidate.loadQueue",
              message: String(event.error),
            }),
          },
        },
      },
    },

    fetchHistory: {
      invoke: {
        id: "fetchHistory",
        src: "fetchHistory",
        input: ({ context }) => ({ entries: context.queueEntries }),
        onDone: {
          target: "listExisting",
          actions: {
            type: "assignHistoryContent",
            params: ({ event }) => ({ content: event.output }),
          },
        },
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "consolidate.fetchHistory",
              message: String(event.error),
            }),
          },
        },
      },
    },

    listExisting: {
      invoke: {
        id: "listExisting",
        src: "listExisting",
        onDone: {
          target: "runAgent",
          actions: {
            type: "assignExistingEntries",
            params: ({ event }) => ({ entries: event.output }),
          },
        },
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "consolidate.listExisting",
              message: String(event.error),
            }),
          },
        },
      },
    },

    runAgent: {
      invoke: {
        id: "runAgent",
        src: "runAgent",
        input: ({ context }) => ({
          journals: context.journals,
          existingEntries: context.existingEntries,
          historyContent: context.historyContent,
        }),
        onDone: {
          target: "parseOutput",
          actions: {
            type: "assignAgentOutput",
            params: ({ event }) => ({ output: event.output }),
          },
        },
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "consolidate.runAgent",
              message: String(event.error),
            }),
          },
        },
      },
    },

    parseOutput: {
      always: [
        {
          guard: "hasParseError",
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ context }) => ({
              _tag: "consolidate.parseOutput",
              message: context.parseError ?? "unknown parse error",
            }),
          },
        },
        {
          guard: "hasEntries",
          target: "writeEntries",
        },
        {
          target: "markProcessed",
        },
      ],
      entry: assign(({ context }) => {
        try {
          return {
            parsedEntries: parseConsolidationOutput(context.agentOutput),
            parseError: undefined,
          };
        } catch (e) {
          return {
            parsedEntries: [] as ParsedKbEntry[],
            parseError: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    },

    writeEntries: {
      invoke: {
        id: "writeEntries",
        src: "writeEntries",
        input: ({ context }) => ({ entries: context.parsedEntries }),
        onDone: {
          target: "markProcessed",
          actions: {
            type: "assignWrittenEntries",
            params: ({ event }) => ({ entries: event.output }),
          },
        },
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "consolidate.writeEntries",
              message: String(event.error),
            }),
          },
        },
      },
    },

    markProcessed: {
      invoke: {
        id: "markProcessed",
        src: "markProcessed",
        input: ({ context }) => ({
          queueIds: context.queueEntries.map((e) => e.id),
          kbIds: context.writtenEntries.map((e) => e.id),
        }),
        onDone: {
          target: "commitChanges",
          actions: {
            type: "assignProcessedCount",
            params: ({ event }) => ({
              count: event.output.count,
              failedIds: event.output.failedIds,
            }),
          },
        },
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "consolidate.markProcessed",
              message: String(event.error),
            }),
          },
        },
      },
    },

    commitChanges: {
      invoke: {
        id: "commitChanges",
        src: "commitChanges",
        input: ({ context }) => ({
          entryCount: context.writtenEntries.length,
          queueCount: context.queueEntries.length,
        }),
        onDone: "completed",
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "consolidate.commitChanges",
              message: String(event.error),
            }),
          },
        },
      },
    },

    completed: {
      type: "final",
    },

    failed: {
      type: "final",
    },
  },
});

export type ConsolidateMachine = typeof consolidateMachine;
