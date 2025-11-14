import "server-only";

import { drizzle, schema, eq } from "@packages/drizzle";
import { FatalError } from "workflow";
import { computeThumbnailVersion } from "~/lib/thumbnail-version";

export async function validateJobStep(
  jobId: string,
  entityId: string,
  version: string,
): Promise<{
  entityId: string;
  userId: string;
  entityType: string;
  elements: string;
  appState: string | null;
}> {
  "use step";

  const entity = (
    await drizzle
      .select({
        id: schema.entities.id,
        userId: schema.entities.userId,
        entityType: schema.entities.entityType,
        elements: schema.entities.elements,
        appState: schema.entities.appState,
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
        entityType: string;
        elements: string;
        appState: string | null;
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
  // Compute current version from entity content
  const currentVersion = computeThumbnailVersion(
    entity.elements,
    entity.appState,
  );

  // Check if job is stale:
  // 1) Outdated job: entity content changed (version mismatch)
  const outdatedDueToVersion = currentVersion !== version;
  // 2) Duplicate job: same version already marked ready
  const duplicateReady =
    entity.thumbnailVersion === version && entity.thumbnailStatus === "ready";

  try {
    console.log(
      "[thumbnail][validate] inputs",
      JSON.stringify({
        jobId,
        entityId,
        jobVersion: version,
        currentVersion,
        entityThumbnailVersion: entity.thumbnailVersion,
        entityThumbnailStatus: entity.thumbnailStatus,
        checks: {
          outdatedDueToVersion,
          duplicateReady,
        },
      }),
    );
  } catch {}

  if (
    // 1) Outdated job: entity content changed (version mismatch)
    outdatedDueToVersion ||
    // 2) Duplicate job: same version already marked ready
    duplicateReady
  ) {
    try {
      console.log(
        "[thumbnail][validate] stale_reason",
        JSON.stringify({ outdatedDueToVersion, duplicateReady }),
      );
    } catch {}
    await drizzle
      .update(schema.thumbnailJobs)
      .set({ status: "stale", updatedAt: new Date() })
      .where(eq(schema.thumbnailJobs.id, jobId))
      .execute();
    throw new FatalError("Thumbnail job is stale");
  }

  return {
    entityId: entity.id,
    userId: entity.userId,
    entityType: entity.entityType,
    elements: entity.elements,
    appState: entity.appState,
  };
}
