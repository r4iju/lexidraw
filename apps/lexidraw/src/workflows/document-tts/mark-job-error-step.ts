import { drizzle, schema } from "@packages/drizzle";
import { jobOfRun } from "./job-of-run";

export async function markJobErrorStep(
  docKey: string,
  runId: string,
  message: string,
): Promise<void> {
  "use step";
  await drizzle
    .update(schema.ttsJobs)
    .set({
      status: "error",
      error: message,
      updatedAt: new Date(),
    })
    .where(jobOfRun(docKey, runId))
    .execute();
}
