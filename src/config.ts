/**
 * configuration system — zero-config with sensible defaults.
 * searches: ./memory.config.json, ~/.config/agent-memory/config.json
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { type } from "arktype";

const StorageSchema = type({
  "root?": "string",
  "autoCommit?": "boolean",
  "commitHook?": "string",
});

const LlmSchema = type({
  "command?": "string",
  "presets?": type.Record("string", "string"),
});

const ScheduleSchema = type({
  "consolidateIntervalHours?": "number >= 1",
  "defragIntervalHours?": "number >= 1",
});

const AgentsMdSchema = type({
  "targets?": "string[]",
});

const ConfigSchema = type({
  "storage?": StorageSchema,
  "llm?": LlmSchema,
  "schedule?": ScheduleSchema,
  "agentsMd?": AgentsMdSchema,
});

export type Config = typeof ConfigSchema.infer;

export interface ResolvedStorage {
  root: string;
  autoCommit: boolean;
  commitHook: string;
}

export interface ResolvedLlm {
  command: string;
  presets: Record<string, string>;
}

export interface ResolvedSchedule {
  consolidateIntervalHours: number;
  defragIntervalHours: number;
}

export interface ResolvedAgentsMd {
  targets: string[];
}

export interface ResolvedConfig {
  storage: ResolvedStorage;
  llm: ResolvedLlm;
  schedule: ResolvedSchedule;
  agentsMd: ResolvedAgentsMd;
}

const DEFAULT_MEMORY_ROOT = join(homedir(), "commonplace", "01_files", "_utilities", "agent-memories");

export const DEFAULT_CONFIG: ResolvedConfig = {
  storage: {
    root: DEFAULT_MEMORY_ROOT,
    autoCommit: true,
    commitHook: "git commit --trailer 'Thread-Id: {threadId}'",
  },
  llm: {
    command: "amp agent run",
    presets: {
      amp: "amp agent run",
      ollama: "ollama run llama3",
    },
  },
  schedule: {
    consolidateIntervalHours: 2,
    defragIntervalHours: 24,
  },
  agentsMd: {
    targets: [join(homedir(), ".config", "amp", "AGENTS.md")],
  },
};

function findConfigFile(): string | null {
  const cwdConfig = join(process.cwd(), "memory.config.json");
  if (existsSync(cwdConfig)) return cwdConfig;

  const homeConfig = join(homedir(), ".config", "agent-memory", "config.json");
  if (existsSync(homeConfig)) return homeConfig;

  return null;
}

export function loadConfig(): ResolvedConfig {
  const configPath = findConfigFile();
  if (!configPath) {
    return DEFAULT_CONFIG;
  }

  try {
    const text = readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(text);
    const validated = ConfigSchema(parsed);

    if (validated instanceof type.errors) {
      console.warn(`config validation failed: ${validated.summary}, using defaults`);
      return DEFAULT_CONFIG;
    }

    return {
      storage: {
        root: validated.storage?.root ?? DEFAULT_CONFIG.storage.root,
        autoCommit: validated.storage?.autoCommit ?? DEFAULT_CONFIG.storage.autoCommit,
        commitHook: validated.storage?.commitHook ?? DEFAULT_CONFIG.storage.commitHook,
      },
      llm: {
        command: validated.llm?.command ?? DEFAULT_CONFIG.llm.command,
        presets: validated.llm?.presets ?? DEFAULT_CONFIG.llm.presets,
      },
      schedule: {
        consolidateIntervalHours: validated.schedule?.consolidateIntervalHours ?? DEFAULT_CONFIG.schedule.consolidateIntervalHours,
        defragIntervalHours: validated.schedule?.defragIntervalHours ?? DEFAULT_CONFIG.schedule.defragIntervalHours,
      },
      agentsMd: {
        targets: validated.agentsMd?.targets ?? DEFAULT_CONFIG.agentsMd.targets,
      },
    };
  } catch (e) {
    console.warn(`failed to load config: ${e instanceof Error ? e.message : String(e)}, using defaults`);
    return DEFAULT_CONFIG;
  }
}

export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}
