import { createHash } from "node:crypto";
import type { ImageArtifact } from "~/lib/images/contracts";
import type { GeneratedImages } from "./generated-images";
export function createAgentImageStore(images: () => GeneratedImages) {
  return {
    async save(
      account: string,
      document: string,
      key: string,
      image: ImageArtifact,
    ) {
      const idempotencyKey = createHash("sha256")
        .update(JSON.stringify([document, key]))
        .digest("hex");
      return (
        await images().save(account, {
          entityId: document,
          idempotencyKey,
          image,
        })
      ).url;
    },
  };
}
