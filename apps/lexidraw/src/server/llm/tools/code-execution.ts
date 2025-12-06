import type { ExecuteCodeSchema } from "@packages/types";
import type { z } from "zod";

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
  const [{ Sandbox }, { default: ms }, { Writable }, { generateToolkitModuleSource }] = await Promise.all([
    import("@vercel/sandbox"),
    import("ms"),
    import("node:stream"),
    import("./code-toolkit"),
  ]);
  const { code, timeoutMs: rawTimeoutMs, resources = { vcpus: 2 } } = args;
  const timeoutMs = typeof rawTimeoutMs === "number" ? rawTimeoutMs : ms("30s");

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

    // Compute per-run baseUrl and mint a short-lived sandbox JWT using existing helper
    let baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXTAUTH_URL || "http://127.0.0.1:3025";
    // Mint a token if we can import the helper at runtime; otherwise skip (toolkit will still compile)
    let jwt = "";
    try {
      const { createSandboxToken } = await import("~/server/auth/sandbox-token");
      jwt = createSandboxToken({ runId: String(Date.now()), ttlMs: timeoutMs });
    } catch {
      jwt = "";
    }

    // Write toolkit and user code to temporary files
    const toolkitFilePath = "/tmp/toolkit.mjs";
    const runnerFilePath = "/tmp/runner.mjs";
    const codeFilePath = "/tmp/user.mjs";
    const writeStdout: string[] = [];
    const writeStderr: string[] = [];

    function writeFileScript(path: string, contents: string): string {
      const contentsJson = JSON.stringify(contents);
      return `require('fs').writeFileSync('${path}', ${contentsJson}, 'utf-8');`;
    }
    const toolkitSrc = generateToolkitModuleSource({ baseUrl, jwt });
    const runnerSrc = `
import { buildTools } from '${toolkitFilePath}';
const tools = await buildTools();
const mod = await import('${codeFilePath}');
const fn = mod?.default ?? mod;
const result = typeof fn === 'function' ? await fn(tools) : fn;
if (typeof result !== 'undefined') {
  try { console.log(JSON.stringify({ __value: result })); } catch {}
}
`.trim();
    const batchedWriteScript = [
      writeFileScript(toolkitFilePath, toolkitSrc),
      writeFileScript(codeFilePath, String(code)),
      writeFileScript(runnerFilePath, runnerSrc),
    ].join("\n");

    await sandbox.runCommand({
      cmd: "node",
      args: ["-e", batchedWriteScript],
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

    // Execute the runner (which loads the user code with tools) and capture output
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const execResult = await sandbox.runCommand({
      cmd: "node",
      args: [runnerFilePath],
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
