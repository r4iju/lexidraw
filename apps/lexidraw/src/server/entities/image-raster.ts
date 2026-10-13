import { inflateSync } from "node:zlib";
/** Decode only the already structurally validated fixed PNG subset, with a hard pixel bound. */
export function validateImagePixels(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stride = 1024 * (bytes[25] === 2 ? 3 : 4) + 1;
  const chunks: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = view.getUint32(offset);
    if (view.getUint32(offset + 4) === 0x49444154)
      chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const pixels = inflateSync(Buffer.concat(chunks), {
    maxOutputLength: stride * 1024,
  });
  if (pixels.length !== stride * 1024) throw new Error("Invalid image pixels");
  for (let row = 0; row < 1024; row++)
    if ((pixels[row * stride] ?? 255) > 4)
      throw new Error("Invalid PNG row filter");
}
