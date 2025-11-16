import { Sandbox } from "@vercel/sandbox";
import ms from "ms";
import type { ExecuteCodeSchema } from "@packages/types";
import type { z } from "zod";
import { Writable } from "node:stream";

type ExecuteCodeInput = z.infer<typeof ExecuteCodeSchema>;

export interface ExecuteCodeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Executes code in a Vercel Sandbox with isolation and resource limits.
 *
 * @param args - Code execution parameters
 * @returns Result with stdout, stderr, exit code, and duration
 */
export async function executeCodeInSandbox(
  args: ExecuteCodeInput,
): Promise<ExecuteCodeResult> {
  const {
    code,
    // language = "node",
    timeoutMs = ms("30s"),
    resources = { vcpus: 2 },
  } = args;

  const startTime = Date.now();
  let sandbox: Awaited<ReturnType<typeof Sandbox.create>> | null = null;

  try {
    // Create sandbox with specified runtime and resources
    sandbox = await Sandbox.create({
      runtime: "node22",
      timeout: timeoutMs,
      resources: {
        vcpus: resources.vcpus ?? 2,
      },
    });

    // Write code to a temporary file using Node.js to avoid shell quoting issues
    const codeFilePath = "/tmp/main.mjs";
    const writeStdout: string[] = [];
    const writeStderr: string[] = [];

    // Use Node.js to write the file safely (avoids shell injection)
    // JSON.stringify properly escapes the code string
    const codeJson = JSON.stringify(code);
    const writeScript = `require('fs').writeFileSync('${codeFilePath}', ${codeJson}, 'utf-8');`;

    await sandbox.runCommand({
      cmd: "node",
      args: ["-e", writeScript],
      stdout: new Writable({
        write(chunk, _encoding, callback) {
          writeStdout.push(chunk.toString());
          callback();
        },
      }),
      stderr: new Writable({
        write(chunk, _encoding, callback) {
          writeStderr.push(chunk.toString());
          callback();
        },
      }),
    });

    // Execute the code file and capture output
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const execResult = await sandbox.runCommand({
      cmd: "node",
      args: [codeFilePath],
      stdout: new Writable({
        write(chunk, _encoding, callback) {
          stdoutChunks.push(chunk.toString());
          callback();
        },
      }),
      stderr: new Writable({
        write(chunk, _encoding, callback) {
          stderrChunks.push(chunk.toString());
          callback();
        },
      }),
    });

    const durationMs = Date.now() - startTime;

    // Collect stdout and stderr
    const stdout = stdoutChunks.join("");
    const stderr = stderrChunks.join("");
    const exitCode = execResult.exitCode ?? 0;

    return {
      ok: exitCode === 0,
      stdout,
      stderr,
      exitCode,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      stdout: "",
      stderr: `Sandbox execution error: ${errorMessage}`,
      exitCode: 1,
      durationMs,
    };
  } finally {
    // Ensure sandbox is disposed
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch (stopError) {
        console.error("[code-execution] Failed to stop sandbox:", stopError);
      }
    }
  }
}
