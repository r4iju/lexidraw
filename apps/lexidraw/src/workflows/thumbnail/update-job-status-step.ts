import "server-only";

import { drizzle, schema, eq } from "@packages/drizzle";

export async function updateJobStatusStep(
  jobId: string,
  status: "processing" | "error",
  attempts: number,
  nextRunAt?: Date,
  lastError?: string,
): Promise<void> {
  "use step";

  const updateData: {
    status: "processing" | "error";
    attempts: number;
    updatedAt: Date;
    nextRunAt?: Date;
    lastError?: string | null;
  } = {
    status,
    attempts,
    updatedAt: new Date(),
  };

  if (nextRunAt) {
    updateData.nextRunAt = nextRunAt;
  }
  if (lastError !== undefined) {
    updateData.lastError = lastError;
  }

  await drizzle
    .update(schema.thumbnailJobs)
    .set(updateData)
    .where(eq(schema.thumbnailJobs.id, jobId))
    .execute();
}
