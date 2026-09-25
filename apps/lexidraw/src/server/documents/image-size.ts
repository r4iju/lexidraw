import { type NaturalSize, parseNaturalSize } from "@packages/lexical-nodes";

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

const sized = (width: number, height: number) =>
  parseNaturalSize({ width, height });

/**
 * The size a browser shows a picture at, from as many of its first bytes as
 * have arrived: undefined until they include it, or for a format not read
 * here. A JPEG whose Exif turns it a quarter is as wide as it is stored tall.
 */
export function imageSizeOf(bytes: Uint8Array): NaturalSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && ascii(bytes, 1, 3) === "PNG")
    return sized(view.getUint32(16), view.getUint32(20));
  if (bytes.length >= 10 && ascii(bytes, 0, 4) === "GIF8")
    return sized(view.getUint16(6, true), view.getUint16(8, true));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8)
    return jpegSize(bytes, view);
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF")
    return ascii(bytes, 8, 4) === "WEBP" ? webpSize(bytes, view) : undefined;
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp")
    return isobmffSize(bytes, view);
  return svgSize(bytes);
}

function jpegSize(bytes: Uint8Array, view: DataView) {
  let turned = false;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at++;
      continue;
    }
    const length = view.getUint16(at + 2);
    if (marker === 0xe1 && ascii(bytes, at + 4, 4) === "Exif")
      turned =
        (exifOrientation(bytes, view, at + 10, at + 2 + length) ?? 1) > 4;
    // Start-of-frame markers, less the DHT, JPG and DAC ones among them.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      const height = view.getUint16(at + 5);
      const width = view.getUint16(at + 7);
      return turned ? sized(height, width) : sized(width, height);
    }
    at += 2 + length;
  }
  return undefined;
}

function exifOrientation(
  bytes: Uint8Array,
  view: DataView,
  tiff: number,
  end: number,
) {
  if (end > bytes.length || tiff + 8 > end) return undefined;
  const little = ascii(bytes, tiff, 2) === "II";
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return undefined;
  const entries = view.getUint16(ifd, little);
  for (let entry = 0; entry < entries; entry++) {
    const at = ifd + 2 + entry * 12;
    if (at + 12 > end) return undefined;
    if (view.getUint16(at, little) === 0x0112)
      return view.getUint16(at + 8, little);
  }
  return undefined;
}

function webpSize(bytes: Uint8Array, view: DataView) {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 " && bytes.length >= 30)
    return sized(
      view.getUint16(26, true) & 0x3fff,
      view.getUint16(28, true) & 0x3fff,
    );
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = view.getUint32(21, true);
    return sized((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X" && bytes.length >= 30) {
    const triple = (at: number) =>
      (bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16);
    return sized(triple(24) + 1, triple(27) + 1);
  }
  return undefined;
}

/** AVIF and HEIF: the first image spatial extent property, `ispe`. */
function isobmffSize(bytes: Uint8Array, view: DataView) {
  for (let at = 4; at + 16 <= bytes.length; at++)
    if (ascii(bytes, at, 4) === "ispe")
      return sized(view.getUint32(at + 8), view.getUint32(at + 12));
  return undefined;
}

/** Only an SVG that sets both sides in pixels has a size of its own. */
function svgSize(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes);
  const tag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return undefined;
  const side = (name: string) => {
    const value = tag.match(
      new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i"),
    )?.[1];
    return value === undefined ? 0 : Number(value);
  };
  return sized(side("width"), side("height"));
}
