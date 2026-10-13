import type { ExecuteCodeSchema } from "@packages/types";
import type { z } from "zod";

export interface ExecuteCodeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/** Cloud execution has no audited complete parent price bound yet. */
export async function executeCodeInSandbox(
  _args: z.infer<typeof ExecuteCodeSchema>,
  _opts?: { runId?: string },
): Promise<ExecuteCodeResult> {
  throw new Error(
    "Cloud sandbox execution requires a bounded parent action and is unavailable",
  );
}
