import { NarrationPart } from "~/lib/narration/contracts";
import { ProError } from "./ledger";
export function audioSeconds(value: NarrationPart) {
  const part = NarrationPart.parse(value);
  const b = Buffer.from(part.audio, "base64");
  if (
    b.toString("base64") !== part.audio ||
    b.length < 46 ||
    b.length > 5_760_044 ||
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 16) !== "WAVEfmt " ||
    b.readUInt32LE(4) !== b.length - 8 ||
    b.readUInt32LE(16) !== 16 ||
    b.readUInt16LE(20) !== 1 ||
    b.readUInt16LE(22) !== 1 ||
    b.readUInt32LE(24) !== 24000 ||
    b.readUInt32LE(28) !== 48000 ||
    b.readUInt16LE(32) !== 2 ||
    b.readUInt16LE(34) !== 16 ||
    b.toString("ascii", 36, 40) !== "data" ||
    b.readUInt32LE(40) !== b.length - 44 ||
    (b.length - 44) % 2 !== 0
  )
    throw new ProError("Invalid bounded narration audio");
  const seconds = (b.length - 44) / 48000;
  if (part.usage.audio < Math.ceil(seconds * 25))
    throw new ProError("Audio usage does not cover duration");
  return seconds;
}
