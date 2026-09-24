import "server-only";

import { and, eq, isNull, schema, type drizzle } from "@packages/drizzle";
import { start } from "workflow/api";
import { computeThumbnailVersion } from "~/lib/thumbnail-version";
import { generateThumbnailWorkflow } from "~/workflows/thumbnail/generate-thumbnail-workflow";

/** Read the committed content: a concurrent save may already have superseded this write. */
export async function queueThumbnail(
  db: typeof drizzle,
  id: string,
): Promise<void> {
  try {
    const entity = await db.query.entities.findFirst({
      where: and(eq(schema.entities.id, id), isNull(schema.entities.deletedAt)),
    });
    if (!entity || !["document", "drawing"].includes(entity.entityType)) return;
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
    if (job) await start(generateThumbnailWorkflow, [job.id, id, version]);
  } catch (error) {
    console.error("enqueue_thumbnail_job_failed", error);
  }
}
