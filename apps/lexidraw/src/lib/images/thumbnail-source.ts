import { z } from "zod";
const ThumbnailContentType = z.enum([
  "image/svg+xml",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);
// Ordinary searched/file thumbnails retain their existing snapshot upload contract.
export async function loadThumbnailSource(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw Error("Couldn’t load that image. Pick another one.");
  const blob = await response.blob();
  const parsed = ThumbnailContentType.safeParse(blob.type);
  if (!parsed.success) throw Error("That image type isn’t supported.");
  return { blob, contentType: parsed.data };
}
