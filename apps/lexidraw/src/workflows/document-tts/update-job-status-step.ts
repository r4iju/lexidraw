import { drizzle, schema } from "@packages/drizzle";
import { jobOfRun } from "./job-of-run";

export async function updateJobStatusStep(
  docKey: string,
  runId: string,
  status: "processing",
  plannedCount: number,
): Promise<void> {
  "use step";
  await drizzle
    .update(schema.ttsJobs)
    .set({ status, plannedCount, updatedAt: new Date() })
    .where(jobOfRun(docKey, runId))
    .execute();
}
