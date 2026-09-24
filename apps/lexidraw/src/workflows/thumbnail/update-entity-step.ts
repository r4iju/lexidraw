import "server-only";

import { drizzle } from "@packages/drizzle";
import { revalidateEntitiesOutsideRequest } from "~/server/api/entity-cache";
import { storeThumbnail } from "~/server/entities/thumbnail";

export async function updateEntityStep(
  entityId: string,
  lightUrl: string,
  darkUrl: string,
  version: string,
): Promise<void> {
  "use step";

  await storeThumbnail(
    drizzle,
    entityId,
    { light: lightUrl, dark: darkUrl },
    { thumbnailStatus: "ready", thumbnailVersion: version },
    version,
  );

  // A thumbnail is what a listing shows of an entity. This step runs on its
  // own, with no request to carry the revalidation.
  revalidateEntitiesOutsideRequest(entityId);
}
