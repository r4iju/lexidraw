import "server-only";
import { proLedger } from "./runtime";
import { drizzle, schema, eq } from "@packages/drizzle";
import { GeneratedImages } from "~/server/entities/generated-images";
import { createImagePowerRouter } from "~/server/api/routers/image-power";
import { createClient } from "@libsql/client";
import env from "@packages/env";
import { findEntityWith, findReadableFacts } from "~/server/entities/readable";
import { createPrivateImageStore } from "./private-image-store";
let images: GeneratedImages | undefined;
export function generatedImages(): GeneratedImages {
  if (images) return images;
  // Dedicated private-store token, never fall back to the existing public bucket.
  const token = process.env.PRIVATE_IMAGE_BLOB_READ_WRITE_TOKEN;
  const storeId = token?.split("_")[3];
  if (!token || !storeId)
    throw new Error("Private image storage is not configured");
  const store = createPrivateImageStore({ token, storeId });
  images = new GeneratedImages(
    createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN }),
    {
      now: Date.now,
      canEdit: async (account, entityId) =>
        !!(await findEntityWith(drizzle, entityId, account, "edit")),
      canRead: async (account, entityId) =>
        !!(await findReadableFacts(drizzle, entityId, account)),
      store,
    },
  );
  return images;
}
// No environment switch, arbitrary model, or server credential can activate image generation.
export const imagePowerRouter = createImagePowerRouter({
  images: generatedImages,
  ledger: proLedger,
  source: async (account) => {
    const [user] = await drizzle
      .select({ config: schema.users.config })
      .from(schema.users)
      .where(eq(schema.users.id, account));
    return user?.config?.aiPower?.mode ?? "local";
  },
});
