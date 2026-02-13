/**
 * shell-command LLM adapter — pipes prompt to configured shell command.
 * the command reads from stdin and writes to stdout.
 */

export interface ShellAdapterOptions {
  command: string;
  timeout?: number;
}

export async function executeShellLLM(
  prompt: string,
  options: ShellAdapterOptions,
): Promise<string> {
  const timeout = options.timeout ?? 300000;

  const proc = Bun.spawn({
    cmd: ["sh", "-c", options.command],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const writer = proc.stdin.getWriter();
  writer.write(new TextEncoder().encode(prompt));
  writer.close();

  const timeoutId = setTimeout(() => {
    proc.kill();
  }, timeout);

  try {
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`LLM command failed with exit code ${exitCode}: ${stderr}`);
    }

    return stdout.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}
