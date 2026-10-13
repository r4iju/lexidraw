import { utf8Bytes as imagePromptBytes } from "../generation/utf8";
export { utf8Bytes as imagePromptBytes } from "../generation/utf8";

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_MAX_PROMPT_BYTES = 1500;
export function imageRequest(prompt: string) {
  if (!prompt.trim() || imagePromptBytes(prompt) > IMAGE_MAX_PROMPT_BYTES)
    throw new Error("Image exceeds bounded prompt");
  return {
    model: "deterministic-image-fixture",
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "fixture",
    response_format: "b64_json",
  };
}
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function validatePng(
  base64: string,
  assertSafe: (text: string) => void = () => {},
) {
  assertSafe(base64);
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    throw new Error("Invalid image encoding");
  const binary = atob(base64);
  assertSafe(binary);
  const bytes = Uint8Array.from(binary, (x) => x.charCodeAt(0));
  if (bytes.length > IMAGE_MAX_BYTES || bytes.length < 57)
    throw new Error("Invalid image size");
  const view = new DataView(bytes.buffer);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a)
    throw new Error("Invalid PNG");
  let offset = 8,
    chunks = 0,
    data = false,
    ended = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset),
      type = binary.slice(offset + 4, offset + 8);
    if (size > IMAGE_MAX_BYTES || offset + size + 12 > bytes.length)
      throw new Error("Invalid PNG chunk");
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + size)) !==
      view.getUint32(offset + 8 + size)
    )
      throw new Error("Invalid PNG checksum");
    if (chunks++ === 0) {
      if (
        type !== "IHDR" ||
        size !== 13 ||
        view.getUint32(offset + 8) !== 1024 ||
        view.getUint32(offset + 12) !== 1024 ||
        bytes[offset + 16] !== 8 ||
        ![2, 6].includes(bytes[offset + 17] ?? -1) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] !== 0
      )
        throw new Error("Unsupported PNG configuration");
    } else if (type === "IDAT" && !ended) data = true;
    else if (type === "IEND" && size === 0 && data) ended = true;
    else throw new Error("PNG metadata or unsupported chunk rejected");
    offset += size + 12;
    if (ended) break;
  }
  if (!ended || offset !== bytes.length) throw new Error("Incomplete PNG");
  return bytes;
}
