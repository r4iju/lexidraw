import "server-only";

import { and, eq, inArray, schema, type drizzle } from "@packages/drizzle";
import { start } from "workflow/api";
import { computeThumbnailVersion } from "~/lib/thumbnail-version";
import { generateThumbnailWorkflow } from "~/workflows/thumbnail/generate-thumbnail-workflow";

type ThumbnailSource = Pick<
  typeof schema.entities.$inferSelect,
  "id" | "elements" | "appState" | "entityType" | "updatedAt"
>;
export async function queueThumbnail(
  db: typeof drizzle,
  entity: ThumbnailSource,
): Promise<void> {
  try {
    if (!["document", "drawing"].includes(entity.entityType)) return;
    const { id } = entity;
    const version = computeThumbnailVersion(entity.elements, entity.appState);
    const now = new Date();
    const [job] = await db
      .insert(schema.thumbnailJobs)
      .values({
        id: crypto.randomUUID(),
        entityId: id,
        version,
        status: "pending",
        attempts: 0,
        nextRunAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.thumbnailJobs.entityId, schema.thumbnailJobs.version],
        setWhere: inArray(schema.thumbnailJobs.status, [
          "error",
          "done",
          "stale",
        ]),
        set: {
          status: "pending",
          attempts: 0,
          updatedAt: now,
          nextRunAt: now,
          lastError: null,
        },
      })
      .returning();
    await db
      .update(schema.entities)
      .set({ thumbnailStatus: "pending", thumbnailVersion: version })
      .where(
        and(
          eq(schema.entities.id, id),
          eq(schema.entities.updatedAt, entity.updatedAt),
        ),
      );
    // A failed launch leaves the persisted job for the cron runner to retry.
    if (job)
      void start(generateThumbnailWorkflow, [job.id, id, version]).catch(
        (error) => {
          console.error("launch_thumbnail_workflow_failed", error);
        },
      );
  } catch (error) {
    console.error("enqueue_thumbnail_job_failed", error);
  }
}
