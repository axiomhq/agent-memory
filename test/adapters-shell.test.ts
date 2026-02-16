import { describe, expect, test } from "bun:test";
import { executeShellLLM } from "../src/adapters/shell";

describe("executeShellLLM", () => {
  test("pipes prompt to stdin and captures stdout", async () => {
    const result = await executeShellLLM("hello world", { command: "cat" });
    expect(result).toBe("hello world");
  });

  test("handles non-zero exit codes (throws with stderr message)", async () => {
    const error = await executeShellLLM("test input", {
      command: "echo 'error message' >&2 && false",
    }).then(
      () => null,
      (e) => e,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("exit code 1");
    expect(error?.message).toContain("error message");
  });

  test("handles timeout (kills process after timeout)", async () => {
    const start = Date.now();
    const error = await executeShellLLM("test", {
      command: "sleep 10",
      timeout: 100,
    }).then(
      () => null,
      (e) => e,
    );

    const elapsed = Date.now() - start;
    expect(error).toBeInstanceOf(Error);
    expect(elapsed).toBeLessThan(1000);
  });

  test("trims output whitespace", async () => {
    const result = await executeShellLLM("input", {
      command: "echo '  trimmed output  '",
    });
    expect(result).toBe("trimmed output");
  });
});
