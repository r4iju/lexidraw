import { deflateSync } from "node:zlib";
import { crc32, type ImageArtifact } from "~/lib/images/contracts";
let cached: ImageArtifact | undefined;
export function fixtureImage(): ImageArtifact {
  if (cached) return cached;
  function chunk(type: string, data: Buffer) {
    const name = Buffer.from(type),
      size = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1024);
  header.writeUInt32BE(1024, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(1024 * (1024 * 3 + 1), 160);
  for (let y = 0; y < 1024; y++) pixels[y * 3073] = 0;
  cached = {
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    base64: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]).toString("base64"),
  };
  return cached;
}
