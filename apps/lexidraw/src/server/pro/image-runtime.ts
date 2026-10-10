import "server-only";
import { drizzle, schema, eq } from "@packages/drizzle";
import type { GeneratedImages } from "~/server/entities/generated-images";
import { createImagePowerRouter } from "~/server/api/routers/image-power";
import { ProError } from "./ledger";
export function generatedImages(): GeneratedImages {
  throw new ProError(
    "Private image storage is unavailable until authenticated delivery and storage configuration are verified. Keep the completed image on this device.",
  );
}
// No environment switch, arbitrary model, or server credential can activate image generation.
export const imagePowerRouter = createImagePowerRouter({
  images: generatedImages,
  source: async (account) => {
    const [user] = await drizzle
      .select({ config: schema.users.config })
      .from(schema.users)
      .where(eq(schema.users.id, account));
    return user?.config?.aiPower?.mode ?? "local";
  },
});
