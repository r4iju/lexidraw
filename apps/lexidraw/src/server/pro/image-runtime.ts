import "server-only";
import { put, del } from "@vercel/blob";
import { drizzle, schema, eq } from "@packages/drizzle";
import { findEntityWith } from "~/server/entities/readable";
import { GeneratedImages } from "~/server/entities/generated-images";
import { createImagePowerRouter } from "~/server/api/routers/image-power";
import { proLedger } from "./runtime";
export function generatedImages() {
  return new GeneratedImages(proLedger().client, {
    now: Date.now,
    canEdit: async (account, entity) =>
      !!(await findEntityWith(drizzle, entity, account, "edit")),
    store: {
      async put(path, bytes) {
        return (
          await put(path, Buffer.from(bytes), {
            contentType: "image/png",
            access: "public",
            addRandomSuffix: false,
            allowOverwrite: true,
          })
        ).url;
      },
      async remove(path) {
        await del(path);
      },
    },
  });
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
