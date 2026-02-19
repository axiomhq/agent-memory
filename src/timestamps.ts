/**
 * git-based timestamp resolution for memory entries.
 *
 * createdAt: first commit that added the file (git log --follow --diff-filter=A).
 * updatedAt: most recent commit touching the file (git log -1).
 *
 * WHY git timestamps: entries are pure markdown. storing timestamps in the file
 * would break the "no metadata" principle. git history is the single source of
 * truth for when a file was created and last modified.
 */

export interface FileTimestamps {
  createdAt: number;
  updatedAt: number;
}

/**
 * resolve createdAt/updatedAt from git history.
 * returns Date.now()-based fallback for uncommitted or untracked files.
 */
export async function getFileTimestamps(
  rootDir: string,
  filePath: string,
): Promise<FileTimestamps> {
  const now = Date.now();

  const [createdAt, updatedAt] = await Promise.all([
    gitTimestamp(rootDir, filePath, ["--follow", "--diff-filter=A", "--format=%at"]),
    gitTimestamp(rootDir, filePath, ["-1", "--format=%at"]),
  ]);

  return {
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now,
  };
}

async function gitTimestamp(
  rootDir: string,
  filePath: string,
  flags: string[],
): Promise<number | null> {
  try {
    const proc = Bun.spawn(
      ["git", "log", ...flags, "--", filePath],
      { cwd: rootDir, stdout: "pipe", stderr: "pipe" },
    );

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) return null;

    // git log --format=%at outputs epoch seconds, possibly multiple lines
    // take the last non-empty line (for --follow --diff-filter=A, the initial commit is last)
    const lines = stdout.trim().split("\n").filter(Boolean);
    const lastLine = lines.at(-1);
    if (!lastLine) return null;

    const epoch = Number.parseInt(lastLine, 10);
    if (Number.isNaN(epoch)) return null;

    return epoch * 1000; // convert seconds to milliseconds
  } catch {
    return null;
  }
}
