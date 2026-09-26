import { drizzle, schema } from "@packages/drizzle";
import { jobOfRun } from "./job-of-run";

export async function markJobReadyStep(
  docKey: string,
  runId: string,
  data: {
    manifestUrl: string;
    stitchedUrl: string | null;
    segmentCount: number;
  },
): Promise<void> {
  "use step";
  await drizzle
    .update(schema.ttsJobs)
    .set({
      status: "ready",
      manifestUrl: data.manifestUrl,
      stitchedUrl: data.stitchedUrl,
      segmentCount: data.segmentCount,
      updatedAt: new Date(),
    })
    .where(jobOfRun(docKey, runId))
    .execute();
}
