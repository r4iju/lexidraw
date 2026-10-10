import { put, del } from "@vercel/blob";
import { z } from "zod";
import { IMAGE_MAX_BYTES } from "~/lib/images/contracts";
const Configuration = z.strictObject({
  storeId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  token: z.string().min(1),
});
const Path = z
  .string()
  .regex(
    /^generated-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
  );
type Ports = {
  put: (
    path: string,
    bytes: Buffer,
    options: Parameters<typeof put>[2],
  ) => Promise<{ url: string }>;
  del: (path: string, options: Parameters<typeof del>[1]) => Promise<void>;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
};
export function createPrivateImageStore(
  config: z.infer<typeof Configuration>,
  ports: Ports = { put, del, fetch },
) {
  const { storeId, token } = Configuration.parse(config);
  return {
    async put(path: string, bytes: Uint8Array) {
      Path.parse(path);
      if (!bytes.length || bytes.length > IMAGE_MAX_BYTES)
        throw new Error("Invalid image size");
      await ports.put(path, Buffer.from(bytes), {
        access: "private",
        token,
        contentType: "image/png",
        addRandomSuffix: false,
        allowOverwrite: true,
        abortSignal: AbortSignal.timeout(10000),
      });
      return path;
    },
    async remove(path: string) {
      Path.parse(path);
      await ports.del(path, { token, abortSignal: AbortSignal.timeout(10000) });
    },
    async read(path: string): Promise<Uint8Array | null> {
      Path.parse(path);
      // The installed SDK's get follows redirects. The origin is constructed from
      // the configured store identity instead, and no app request headers enter it.
      const response = await ports.fetch(
        `https://${storeId}.private.blob.vercel-storage.com/${path}`,
        {
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.status === 404) return null;
      const length = response.headers.get("content-length");
      const size = length && /^\d+$/.test(length) ? Number(length) : 0;
      if (
        response.status !== 200 ||
        response.redirected ||
        response.headers.get("content-type") !== "image/png" ||
        !size ||
        size > IMAGE_MAX_BYTES ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new Error("Invalid private image response");
      }
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.length;
          if (total > size || total > IMAGE_MAX_BYTES)
            throw new Error("Invalid image size");
          parts.push(part.value);
        }
        if (total !== size) throw new Error("Invalid image size");
        return Buffer.concat(parts, total);
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    },
  };
}
