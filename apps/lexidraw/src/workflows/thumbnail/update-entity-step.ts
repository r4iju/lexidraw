import "server-only";

import { drizzle, schema, eq } from "@packages/drizzle";

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
}
