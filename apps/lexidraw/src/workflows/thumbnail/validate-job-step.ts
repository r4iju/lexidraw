import "server-only";

import { drizzle, schema, eq } from "@packages/drizzle";
import { FatalError } from "workflow";

export async function validateJobStep(
  jobId: string,
  entityId: string,
  version: string,
  jobCreatedAt: Date,
): Promise<{ entityId: string; userId: string }> {
  "use step";

  const entity = (
    await drizzle
      .select({
        id: schema.entities.id,
        userId: schema.entities.userId,
        updatedAt: schema.entities.updatedAt,
        thumbnailVersion: schema.entities.thumbnailVersion,
        thumbnailStatus: schema.entities.thumbnailStatus,
      })
      .from(schema.entities)
      .where(eq(schema.entities.id, entityId))
      .limit(1)
  )[0] as
    | {
        id: string;
        userId: string;
        updatedAt: Date;
        thumbnailVersion?: string | null;
        thumbnailStatus?: string | null;
      }
    | undefined;

  if (!entity) {
    await drizzle
      .update(schema.thumbnailJobs)
      .set({ status: "stale", updatedAt: new Date() })
      .where(eq(schema.thumbnailJobs.id, jobId))
      .execute();
    throw new FatalError("Entity not found for thumbnail job");
  }

  // Check if job is stale
  // Use a small tolerance (1 second) to account for timing differences between
  // entity update and job creation, and database timestamp precision
  const TOLERANCE_MS = 1000;
  const jobCreatedAtTime = jobCreatedAt.getTime();
  const entityUpdatedAtTime = entity.updatedAt?.getTime() ?? 0;

  // Diagnostics: capture timing relationships and which condition triggers
  const outdatedDueToTiming =
    entityUpdatedAtTime > jobCreatedAtTime + TOLERANCE_MS;
  const duplicateReady =
    entity.thumbnailVersion === version && entity.thumbnailStatus === "ready";

  try {
    console.log(
      "[thumbnail][validate] inputs",
      JSON.stringify({
        jobId,
        entityId,
        version,
        jobCreatedAtISO: new Date(jobCreatedAtTime).toISOString(),
        jobCreatedAtMs: jobCreatedAtTime,
        entityUpdatedAtISO: new Date(entityUpdatedAtTime).toISOString(),
        entityUpdatedAtMs: entityUpdatedAtTime,
        diffMs: entityUpdatedAtTime - jobCreatedAtTime,
        toleranceMs: TOLERANCE_MS,
        checks: {
          outdatedDueToTiming,
          duplicateReady,
        },
      }),
    );
  } catch {}

  if (
    // 1) Outdated job: entity changed significantly after job creation (more than tolerance)
    outdatedDueToTiming ||
    // 2) Duplicate job: same version already marked ready
    duplicateReady
  ) {
    try {
      console.log(
        "[thumbnail][validate] stale_reason",
        JSON.stringify({ outdatedDueToTiming, duplicateReady }),
      );
    } catch {}
    await drizzle
      .update(schema.thumbnailJobs)
      .set({ status: "stale", updatedAt: new Date() })
      .where(eq(schema.thumbnailJobs.id, jobId))
      .execute();
    throw new FatalError("Thumbnail job is stale");
  }

  return { entityId: entity.id, userId: entity.userId };
}
