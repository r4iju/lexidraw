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
 * Invalid incidental signatures are allowed only in independently typed audio.
 */
export function compressionInspector(audioContext = false) {
  let candidates = 0;
  let inflatedWork = 0;
  const blocked = () => new Error("Credential egress blocked");
  function inspect(binary: string, samples: boolean, depth = 0): string[] {
    if (depth > 8) throw blocked();
    const recovered: string[] = [];
    // Keep the established metadata-free PNG policy at its existing image boundary.
    if (samples) audioContext = true;
    let png = false;
    if (!audioContext && binary.startsWith("\x89PNG\r\n\x1a\n")) {
      try {
        validatePng(btoa(binary));
        png = true;
      } catch {
        /* Not a validated PNG. */
      }
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
        // A magic byte sequence alone is ordinary PCM noise. A bounded local
        // file header with an actual filename identifies an unsupported archive.
        if (
          !samples ||
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
      if (!gzip && (!zlib || png)) continue;
      if (++candidates > 4096) throw blocked();
      if (
        !samples &&
        (gzip || (i === 0 && a === 0x78 && [1, 0x9c, 0xda].includes(b)))
      )
        throw blocked();
      // Fixed input/window/output sizes. Stop at the first output chunk, before
      // a compression bomb can allocate or expand its complete plaintext.
      const inflater = new Inflate({ chunkSize: 4096, windowBits: 47 });
      const stop = {};
      inflater.onData = () => {
        throw stop;
      };
      try {
        inflater.push(
          Uint8Array.from(binary.slice(i, i + 65_536), (c) => c.charCodeAt(0)),
          true,
        );
      } catch (error) {
        if (error === stop) throw blocked();
        throw blocked();
      }
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
