import "server-only";

import { drizzle, schema, eq } from "@packages/drizzle";
import { revalidateEntitiesOutsideRequest } from "~/server/api/entity-cache";

export async function updateEntityStep(
  entityId: string,
  lightUrl: string,
  darkUrl: string,
  version: string,
): Promise<void> {
  "use step";

  await drizzle
    .update(schema.entities)
    .set({
      screenShotLight: lightUrl,
      screenShotDark: darkUrl,
      thumbnailStatus: "ready",
      thumbnailUpdatedAt: new Date(),
      thumbnailVersion: version,
      updatedAt: new Date(),
    })
    .where(eq(schema.entities.id, entityId))
    .execute();

  // A thumbnail is what a listing shows of an entity. This step runs on its
  // own, with no request to carry the revalidation.
  revalidateEntitiesOutsideRequest(entityId);
}
