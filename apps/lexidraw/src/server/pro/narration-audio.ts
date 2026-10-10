import { validateWav } from "~/lib/narration/portable";
import { NarrationPart } from "~/lib/narration/contracts";
import { ProError } from "./ledger";
export function audioSeconds(value: NarrationPart) {
  const part = NarrationPart.parse(value);
  const { seconds } = validateWav(part.audio);
  if (part.usage.audio < Math.ceil(seconds * 25))
    throw new ProError("Audio usage does not cover duration");
  return seconds;
}
