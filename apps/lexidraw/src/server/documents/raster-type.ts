/** The pictures a browser shows that cannot carry script, as their bytes say. */
export const RASTER_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/x-icon",
] as const;
export type RasterType = (typeof RASTER_TYPES)[number];

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/** What picture `bytes` begin, or undefined for anything else. */
export function rasterTypeOf(bytes: Uint8Array): RasterType | undefined {
  if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")
    return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return "image/webp";
  if (
    ascii(bytes, 4, 4) === "ftyp" &&
    ["avif", "avis"].includes(ascii(bytes, 8, 4))
  )
    return "image/avif";
  if (ascii(bytes, 0, 4) === "\0\0\x01\0" && bytes.length >= 6)
    return "image/x-icon";
  return undefined;
}

/** The file extension a picture of `type` is kept under. */
export const extensionOf = (type: RasterType) =>
  type === "image/x-icon"
    ? "ico"
    : type === "image/jpeg"
      ? "jpg"
      : type.slice(6);
