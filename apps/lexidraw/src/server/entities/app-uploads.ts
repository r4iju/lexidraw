import env from "@packages/env";
import { TRPCError } from "@trpc/server";
import { del } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { v4 as uuidV4 } from "uuid";
import { z } from "zod";
import { IMAGE } from "~/lib/media-kinds";
import { extensionOf, rasterTypeOf } from "~/server/documents/raster-type";
import { blobUploadRequest } from "./blob-upload";

/** The pictures the web takes, less SVG, which can carry script. */
export const AppUploadType = z.enum(IMAGE.types).exclude(["image/svg+xml"]);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Signs `userId`'s upload of a picture straight to the store. Its root-level
 * name is recorded nowhere until a document takes it, so the hourly cleanup
 * deletes one no document took.
 */
export async function signAppUpload(
  userId: string,
  contentType: z.infer<typeof AppUploadType>,
  size: number,
) {
  if (size > IMAGE.maxBytes)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: `This picture is ${Math.round(size / 100_000) / 10} MB, over the ${IMAGE.maxBytes / 1024 / 1024} MB a picture may be`,
    });
  const pathname = `${userId}-${uuidV4()}.${extensionOf(contentType)}`;
  const token = await generateClientTokenFromReadWriteToken({
    token: env.BLOB_READ_WRITE_TOKEN,
    pathname,
    allowedContentTypes: [contentType],
    maximumSizeInBytes: size,
    addRandomSuffix: false,
    validUntil: Date.now() + 10 * 60_000,
  });
  return {
    url: `${env.VERCEL_BLOB_STORAGE_HOST}/${pathname}`,
    upload: blobUploadRequest(pathname, token, contentType),
  };
}

export type AppUpload = { url: string; pathname: string };

/** The pictures `userId` sent from the app that `elements` shows. */
export function appUploadsIn(elements: string, userId: string): AppUpload[] {
  const sent = new RegExp(
    `^${escaped(env.VERCEL_BLOB_STORAGE_HOST)}/(${escaped(userId)}-${UUID}\\.[a-z]+)$`,
  );
  const found = new Map<string, AppUpload>();
  const visit = (node: unknown) => {
    if (!isNode(node)) return;
    const { type, src, children } = node;
    const pathname =
      type === "image" && typeof src === "string" && sent.exec(src)?.[1];
    if (pathname && typeof src === "string")
      found.set(src, { url: src, pathname });
    if (Array.isArray(children)) children.forEach(visit);
  };
  visit(Elements.parse(JSON.parse(elements)).root);
  return [...found.values()];
}

const Elements = z.object({ root: z.unknown() });
/** Every field of a node is optional, so any object in a document is one. */
const isNode = (
  value: unknown,
): value is { type?: unknown; src?: unknown; children?: unknown } =>
  typeof value === "object" && value !== null;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Refuses a document whose sent pictures are missing or aren't raster
 * pictures by their bytes, whatever type they were sent as; those are
 * deleted.
 */
export async function checkAppUploads(uploads: AppUpload[]) {
  for (const { url } of uploads) {
    const response = await fetch(url, { headers: { range: "bytes=0-31" } });
    if (!response.ok)
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: "A picture in it was never sent; send it, then try again",
      });
    if (!rasterTypeOf(new Uint8Array(await response.arrayBuffer()))) {
      await del(url);
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: "A picture in it is no picture Lexidraw shows",
      });
    }
  }
}
