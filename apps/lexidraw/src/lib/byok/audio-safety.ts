import { validatePng } from "../images/format";
import { Inflate } from "./vendor/pako-inflate.js";

/** Independently recognize only the fixed uncompressed audio adapter's container. */
export function canonicalWav(binary: string) {
  if (
    binary.length < 46 ||
    binary.length > 5_760_044 ||
    (binary.length - 44) % 2
  )
    return false;
  const word = (offset: number, count: number) => {
    let n = 0;
    for (let i = 0; i < count; i++)
      n += binary.charCodeAt(offset + i) * 2 ** (8 * i);
    return n;
  };
  return (
    binary.slice(0, 4) === "RIFF" &&
    binary.slice(8, 16) === "WAVEfmt " &&
    binary.slice(36, 40) === "data" &&
    word(4, 4) === binary.length - 8 &&
    word(16, 4) === 16 &&
    word(20, 2) === 1 &&
    word(22, 2) === 1 &&
    word(24, 4) === 24000 &&
    word(28, 4) === 48000 &&
    word(32, 2) === 2 &&
    word(34, 2) === 16 &&
    word(40, 4) === binary.length - 44
  );
}

/** Valid compressed containers are unsupported inside declared PCM.
 * Reject them even without a device key registry (the server never gets one).
 * Recoverable fragments from invalid candidates still pass the known-key scanner.
 * Invalid incidental signatures are allowed in typed audio and PNG channel bytes.
 */
export function compressionInspector(
  audioContext = false,
  checkPixels: (binary: string) => void = () => {},
) {
  let candidates = 0;
  let inflatedWork = 0;
  let compressedWork = 0;
  let imageWork = 0;
  const blocked = () => new Error("Credential egress blocked");
  function inspect(
    binary: string,
    samples: boolean,
    depth = 0,
    typedPixels = false,
  ): string[] {
    if (depth > 8) throw blocked();
    const recovered: string[] = [];
    let octets: Uint8Array | undefined;
    if (samples) audioContext = true;
    let png: Uint8Array | undefined;
    if (!audioContext && binary.startsWith("\x89PNG\r\n\x1a\n")) {
      try {
        png = validatePng(btoa(binary));
      } catch {
        /* Not a PNG. */
      }
    }
    if (png) {
      const channels = png[25] === 2 ? 3 : 4;
      const stride = 1024 * channels + 1;
      const expected = stride * 1024;
      imageWork += expected;
      if (imageWork > 512 * 1024 * 1024) throw blocked();
      const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
      const idat: Uint8Array[] = [];
      let size = 0;
      for (let offset = 8; offset + 12 <= png.length; ) {
        const length = view.getUint32(offset);
        if (view.getUint32(offset + 4) === 0x49444154) {
          const part = png.subarray(offset + 8, offset + 8 + length);
          idat.push(part);
          size += part.length;
        }
        offset += length + 12;
      }
      const input = new Uint8Array(size);
      let cursor = 0;
      for (const part of idat) {
        input.set(part, cursor);
        cursor += part.length;
      }
      const output = new Uint8Array(expected);
      const inflater = new Inflate({ chunkSize: 65_536, windowBits: 15 });
      let count = 0;
      inflater.onData = (chunk) => {
        if (count + chunk.length > expected) throw blocked();
        output.set(chunk, count);
        count += chunk.length;
      };
      try {
        inflater.push(input, true);
      } catch {
        throw blocked();
      }
      if (
        !inflater.ended ||
        inflater.err ||
        count !== expected ||
        inflater.strm.total_in !== size
      )
        throw blocked();
      const check = (bytes: Uint8Array) => {
        let text = "";
        for (const byte of bytes) text += String.fromCharCode(byte);
        checkPixels(text);
        checkPixels(new TextDecoder().decode(bytes));
        // Typed channels can contain incidental headers. Recoverable compressed
        // nodes still use the same finite scanner before image admission.
        recovered.push(...inspect(text, false, depth + 1, true));
      };
      check(output);
      const pixels = new Uint8Array(expected - 1024);
      for (let row = 0; row < 1024; row++) {
        const start = row * stride,
          filter = output[start] ?? 255;
        if (filter > 4) throw blocked();
        if (filter)
          for (let column = 1; column < stride; column++) {
            const index = start + column;
            const a = column > channels ? (output[index - channels] ?? 0) : 0;
            const b = row ? (output[index - stride] ?? 0) : 0;
            const c =
              row && column > channels
                ? (output[index - stride - channels] ?? 0)
                : 0;
            const p = a + b - c;
            const pa = Math.abs(p - a),
              pb = Math.abs(p - b),
              pc = Math.abs(p - c);
            const prediction =
              filter === 1
                ? a
                : filter === 2
                  ? b
                  : filter === 3
                    ? Math.floor((a + b) / 2)
                    : pa <= pb && pa <= pc
                      ? a
                      : pb <= pc
                        ? b
                        : c;
            output[index] = ((output[index] ?? 0) + prediction) & 255;
          }
        pixels.set(
          output.subarray(start + 1, start + stride),
          row * (stride - 1),
        );
      }
      check(pixels);
      return recovered;
    }
    for (let i = 0; i + 1 < binary.length; i++) {
      const a = binary.charCodeAt(i),
        b = binary.charCodeAt(i + 1);
      const gzip = a === 0x1f && b === 0x8b && binary.charCodeAt(i + 2) === 8;
      const zlib = (a & 15) === 8 && a >> 4 <= 7 && (a * 256 + b) % 31 === 0;
      if (binary.slice(i, i + 4) === "PK\x03\x04") {
        const word = (offset: number) =>
          binary.charCodeAt(i + offset) +
          binary.charCodeAt(i + offset + 1) * 256;
        const version = word(4),
          name = word(26),
          extra = word(28);
        // A magic byte sequence alone can be ordinary samples. A bounded local
        // file header with an actual filename identifies an unsupported archive.
        if (
          (!samples && !typedPixels) ||
          (binary.length - i >= 30 &&
            version >= 10 &&
            version <= 63 &&
            name > 0 &&
            name <= 4096 &&
            extra <= 16_384 &&
            30 + name + extra <= binary.length - i)
        )
          throw blocked();
        continue;
      }
      if (!gzip && !zlib) continue;
      if (
        !audioContext &&
        !typedPixels &&
        (gzip || (i === 0 && a === 0x78 && [1, 0x9c, 0xda].includes(b)))
      )
        throw blocked();
      // Fixed input/window/output sizes. Stop at the first output chunk, before
      // a compression bomb can allocate or expand its complete plaintext.
      const inflater = new Inflate({ chunkSize: 4096, windowBits: 47 });
      inflater.onData = () => {
        throw blocked();
      };
      try {
        // Reuse the bounded node bytes instead of copying 64 KiB for each
        // incidental header in a long PCM transfer.
        octets ??= Uint8Array.from(binary, (c) => c.charCodeAt(0));
        inflater.push(octets.subarray(i, i + 65_536), true);
      } catch {
        throw blocked();
      }
      compressedWork += inflater.strm.total_in;
      if (compressedWork > 512 * 1024 * 1024) throw blocked();
      // Incidental headers consume input work, but only a recoverable node
      // consumes candidate capacity. Neither is evidence of confidentiality.
      if (inflater.strm.total_out || (inflater.ended && inflater.err === 0))
        if (++candidates > 4096) throw blocked();
      if (
        inflater.strm.avail_out === 0 ||
        (inflater.ended && inflater.err === 0) ||
        (inflater.strm.avail_in === 0 && binary.length - i > 65_536)
      )
        throw blocked();
      inflatedWork += inflater.strm.total_out;
      if (inflatedWork > 262_144) throw blocked();
      // Invalid short candidates can occur in hash bytes or samples. Inspect
      // any recoverable output with the same detector/work budgets.
      if (inflater.strm.total_out) {
        const bytes = inflater.strm.output.subarray(0, inflater.strm.next_out);
        let plain = "";
        for (const byte of bytes) plain += String.fromCharCode(byte);
        recovered.push(
          plain,
          new TextDecoder().decode(bytes),
          ...inspect(plain, false, depth + 1),
        );
      }
    }
    return recovered;
  }
  return inspect;
}
