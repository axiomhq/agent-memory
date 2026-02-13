/**
 * defrag machine — reorganizes memory filesystem, generates AGENTS.md.
 *
 * per WORKFLOW = DATA: the machine is a record with state, not a running process.
 * per INJECT AT THE BOUNDARY: adapters injected via machine.provide().
 *
 * states: scanEntries → runAgent → applyChanges → generateAgentsMd → commitChanges → completed | failed
 */

import { setup, assign, fromPromise } from "xstate";
import { parseDefragOutput, type EntryForDefrag, type DefragDecision, type DefragAction } from "../prompts/defrag.js";

export interface DefragError {
  _tag: string;
  message: string;
}

export interface DefragContext {
  entries: EntryForDefrag[];
  agentOutput: string;
  decision: DefragDecision | null;
  parseError?: string;
  appliedActions: number;
  error?: DefragError;
}

export interface DefragInput {}

const scanEntriesActor = fromPromise<EntryForDefrag[], void>(async () => {
  throw new Error("scanEntries: not provided via machine.provide()");
});

const runAgentActor = fromPromise<string, { entries: EntryForDefrag[] }>(async () => {
  throw new Error("runAgent: not provided via machine.provide()");
});

const applyChangesActor = fromPromise<number, { actions: DefragAction[] }>(async () => {
  throw new Error("applyChanges: not provided via machine.provide()");
});

const generateAgentsMdActor = fromPromise<void, { hotTier: string[]; warmTier: string[]; entries: EntryForDefrag[] }>(
  async () => {
    throw new Error("generateAgentsMd: not provided via machine.provide()");
  },
);

const commitChangesActor = fromPromise<void, void>(async () => {
  throw new Error("commitChanges: not provided via machine.provide()");
});

export const defragMachine = setup({
  types: {
    context: {} as DefragContext,
    input: {} as DefragInput,
  },
  actors: {
    scanEntries: scanEntriesActor,
    runAgent: runAgentActor,
    applyChanges: applyChangesActor,
    generateAgentsMd: generateAgentsMdActor,
    commitChanges: commitChangesActor,
  },
  actions: {
    assignEntries: assign({
      entries: (_, params: { entries: EntryForDefrag[] }) => params.entries,
    }),
    assignAgentOutput: assign({
      agentOutput: (_, params: { output: string }) => params.output,
    }),
    assignDecision: assign({
      decision: (_, params: { decision: DefragDecision }) => params.decision,
    }),
    assignParseError: assign({
      parseError: (_, params: { message: string }) => params.message,
    }),
    assignAppliedActions: assign({
      appliedActions: (_, params: { count: number }) => params.count,
    }),
    assignError: assign({
      error: (_, params: { _tag: string; message: string }) => ({
        _tag: params._tag,
        message: params.message,
      }),
    }),
  },
  guards: {
    hasEntries: (_, params: { entries: EntryForDefrag[] }) => params.entries.length > 0,
    hasDecision: ({ context }) => context.decision !== null,
    hasActions: ({ context }) => (context.decision?.actions.length ?? 0) > 0,
    hasParseError: ({ context }) => context.parseError !== undefined,
  },
}).createMachine({
  id: "defrag",
  initial: "scanEntries",
  context: () => ({
    entries: [],
    agentOutput: "",
    decision: null,
    appliedActions: 0,
  }),

  states: {
    scanEntries: {
      invoke: {
        id: "scanEntries",
        src: "scanEntries",
        onDone: [
          {
            guard: {
              type: "hasEntries",
              params: ({ event }) => ({ entries: event.output }),
            },
            target: "runAgent",
            actions: {
              type: "assignEntries",
              params: ({ event }) => ({ entries: event.output }),
            },
          },
          {
            target: "completed",
            actions: {
              type: "assignEntries",
              params: ({ event }) => ({ entries: event.output }),
            },
          },
        ],
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "defrag.scanEntries",
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
        input: ({ context }) => ({ entries: context.entries }),
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
              _tag: "defrag.runAgent",
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
              _tag: "defrag.parseOutput",
              message: context.parseError ?? "unknown parse error",
            }),
          },
        },
        {
          target: "applyChanges",
        },
      ],
      entry: assign(({ context }) => {
        try {
          return {
            decision: parseDefragOutput(context.agentOutput),
            parseError: undefined,
          };
        } catch (e) {
          return {
            decision: null,
            parseError: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    },

    applyChanges: {
      invoke: {
        id: "applyChanges",
        src: "applyChanges",
        input: ({ context }) => ({ actions: context.decision?.actions ?? [] }),
        onDone: {
          target: "generateAgentsMd",
          actions: {
            type: "assignAppliedActions",
            params: ({ event }) => ({ count: event.output }),
          },
        },
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "defrag.applyChanges",
              message: String(event.error),
            }),
          },
        },
      },
    },

    generateAgentsMd: {
      invoke: {
        id: "generateAgentsMd",
        src: "generateAgentsMd",
        input: ({ context }) => ({
          hotTier: context.decision?.hotTier ?? [],
          warmTier: context.decision?.warmTier ?? [],
          entries: context.entries,
        }),
        onDone: "commitChanges",
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "defrag.generateAgentsMd",
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
        onDone: "completed",
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({
              _tag: "defrag.commitChanges",
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

export type DefragMachine = typeof defragMachine;
