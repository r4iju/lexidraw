import type { ExecuteCodeSchema } from "@packages/types";
import { Sandbox } from "@vercel/sandbox";
import ms from "ms";
import { Writable } from "node:stream";
import type { z } from "zod";

type ExecuteCodeInput = z.infer<typeof ExecuteCodeSchema>;

export interface ExecuteCodeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

type ExecuteCodeInSandboxOptions = {
  /**
   * Optional workflow run ID for observability/logging.
   * (Not passed into the sandboxed code.)
   */
  runId?: string;
};

const DEFAULT_TIMEOUT_MS = ms("30s");
const MAX_CODE_CHARS = 50_000;
const MAX_STDOUT_CHARS = 32_000;
const MAX_STDERR_CHARS = 32_000;

function createLimitedUtf8Collector(maxChars: number): {
  writable: Writable;
  getText: () => string;
} {
  let text = "";
  let truncated = false;
  return {
    writable: new Writable({
      write(chunk, _encoding, callback) {
        if (truncated) {
          callback();
          return;
        }
        const asString = Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk);
        const remaining = maxChars - text.length;
        if (remaining <= 0) {
          truncated = true;
          callback();
          return;
        }
        if (asString.length > remaining) {
          text += asString.slice(0, remaining);
          truncated = true;
          callback();
          return;
        }
        text += asString;
        callback();
      },
    }),
    getText: () =>
      truncated ? `${text}\n…[truncated to ${maxChars} chars]` : text,
  };
}

/**
 * Executes code in a Vercel Sandbox with isolation and resource limits.
 *
 * @param args - Code execution parameters
 * @param opts - Optional metadata (not passed to the sandbox)
 */
export async function executeCodeInSandbox(
  args: ExecuteCodeInput,
  opts?: ExecuteCodeInSandboxOptions,
): Promise<ExecuteCodeResult> {
  const { code, timeoutMs: rawTimeoutMs, resources } = args;
  const timeoutMs =
    typeof rawTimeoutMs === "number" ? rawTimeoutMs : DEFAULT_TIMEOUT_MS;
  const vcpus = resources?.vcpus ?? 2;

  const startTime = Date.now();
  let sandbox: Awaited<ReturnType<typeof Sandbox.create>> | null = null;

  if (code.length > MAX_CODE_CHARS) {
    return {
      ok: false,
      stdout: "",
      stderr: `Code too large: ${code.length} chars (max ${MAX_CODE_CHARS})`,
      exitCode: 1,
      durationMs: Date.now() - startTime,
    };
  }

  try {
    sandbox = await Sandbox.create({
      runtime: "node22",
      timeout: timeoutMs,
      resources: { vcpus },
    });

    const mainFilePath = "/tmp/main.mjs";
    const writeScript = `require('fs').writeFileSync(${JSON.stringify(
      mainFilePath,
    )}, ${JSON.stringify(code)}, 'utf8');`;

    const writeRes = await sandbox.runCommand({
      cmd: "node",
      args: ["-e", writeScript],
    });

    const writeExit =
      typeof writeRes.exitCode === "number" ? writeRes.exitCode : 0;
    if (writeExit !== 0) {
      return {
        ok: false,
        stdout: "",
        stderr: `Failed to write sandbox file (exitCode=${writeExit})${opts?.runId ? ` runId=${opts.runId}` : ""}`,
        exitCode: writeExit,
        durationMs: Date.now() - startTime,
      };
    }

    const stdoutCollector = createLimitedUtf8Collector(MAX_STDOUT_CHARS);
    const stderrCollector = createLimitedUtf8Collector(MAX_STDERR_CHARS);

    const execRes = await sandbox.runCommand({
      cmd: "node",
      args: [mainFilePath],
      stdout: stdoutCollector.writable,
      stderr: stderrCollector.writable,
    });

    const exitCode =
      typeof execRes.exitCode === "number" ? execRes.exitCode : 0;

    return {
      ok: exitCode === 0,
      stdout: stdoutCollector.getText(),
      stderr: stderrCollector.getText(),
      exitCode,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      stdout: "",
      stderr: `Sandbox execution error: ${errorMessage}`,
      exitCode: 1,
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch (stopError) {
        console.error("[code-execution] Failed to stop sandbox:", stopError);
      }
    }
  }
}
