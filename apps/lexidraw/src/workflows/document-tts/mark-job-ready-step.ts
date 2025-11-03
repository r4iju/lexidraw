import { schema, drizzle, eq } from "@packages/drizzle";

export async function markJobReadyStep(
  docKey: string,
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
    .where(eq(schema.ttsJobs.id, docKey))
    .execute();
}
