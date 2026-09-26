import { drizzle, schema } from "@packages/drizzle";
import { jobOfRun } from "./job-of-run";

export async function updateProgressStep(
  docKey: string,
  runId: string,
  completedSegments: number,
): Promise<void> {
  "use step";
  await drizzle
    .update(schema.ttsJobs)
    .set({
      segmentCount: completedSegments,
      updatedAt: new Date(),
    })
    .where(jobOfRun(docKey, runId))
    .execute();
}
