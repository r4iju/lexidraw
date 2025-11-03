import "server-only";

import { drizzle, schema, eq } from "@packages/drizzle";

export async function markJobDoneStep(jobId: string): Promise<void> {
  "use step";

  await drizzle
    .update(schema.thumbnailJobs)
    .set({ status: "done", updatedAt: new Date() })
    .where(eq(schema.thumbnailJobs.id, jobId))
    .execute();
}
