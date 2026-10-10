import { imagePromptBytes } from "../images/format";
export const DEVICE_NARRATION_UNAVAILABLE =
  "OpenRouter narration is unavailable until actual access, audio format and an enforceable output bound are verified. Saved recordings play free without a key.";
export const DEVICE_NARRATION_POLICY =
  "Generation runs only while this app or browser can run. Suspension or shutdown can interrupt it. Completed parts stay on this device. Resume requires a current key. An interrupted provider request may still be billed; uncertain parts are held and never automatically repeated. Syncing completed audio and saved playback use no Pro credits.";
export const SPEECH_PATH = "/api/v1/audio/speech";
export const MAX_AUDIO_BYTES = 5_760_044;
export function narrationTexts(text: string) {
  if (!text.trim() || imagePromptBytes(text) > 6000)
    throw new Error("Document exceeds narration bounds");
  const chars = Array.from(text),
    parts: string[] = [];
  for (let i = 0; i < chars.length; i += 500)
    parts.push(chars.slice(i, i + 500).join(""));
  if (parts.length > 8) throw new Error("Document exceeds narration bounds");
  return parts;
}
export function speechRequest(text: string) {
  if (narrationTexts(text).length !== 1)
    throw new Error("Part exceeds narration bounds");
  return {
    model: "google/gemini-3.8-flash-lite-tts",
    input: text,
    voice: "Kore",
    instructions:
      "Read the supplied text faithfully with clear, natural narration.",
    response_format: "pcm",
  };
}
export type DeviceAudio = { audio: string; seconds: number };
export function pcmWav(bytes: Uint8Array) {
  if (!bytes.length || bytes.length % 2 || bytes.length > MAX_AUDIO_BYTES - 44)
    throw new Error("Invalid bounded audio");
  const wav = new Uint8Array(bytes.length + 44),
    view = new DataView(wav.buffer);
  for (const [offset, text] of [
    [0, "RIFF"],
    [8, "WAVEfmt "],
    [36, "data"],
  ] as const)
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
  view.setUint32(4, wav.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, bytes.length, true);
  wav.set(bytes, 44);
  return wav;
}
export function validateWav(
  base64: string,
  check: (text: string) => void = () => {},
) {
  if (base64.length > 7_680_060) throw new Error("Invalid bounded audio");
  check(base64);
  const binary = atob(base64);
  check(binary);
  const bytes = Uint8Array.from(binary, (x) => x.charCodeAt(0)),
    view = new DataView(bytes.buffer);
  const ascii = (start: number, end: number) => binary.slice(start, end);
  if (
    bytes.length < 46 ||
    bytes.length > MAX_AUDIO_BYTES ||
    btoa(binary) !== base64 ||
    ascii(0, 4) !== "RIFF" ||
    ascii(8, 16) !== "WAVEfmt " ||
    ascii(36, 40) !== "data" ||
    view.getUint32(4, true) !== bytes.length - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== 24000 ||
    view.getUint32(28, true) !== 48000 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== bytes.length - 44 ||
    (bytes.length - 44) % 2
  )
    throw new Error("Invalid bounded audio");
  return { bytes, seconds: (bytes.length - 44) / 48000 };
}
export function audioFromPCM(bytes: Uint8Array, check: (text: string) => void) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  check(binary);
  const wav = pcmWav(bytes);
  binary = "";
  for (const byte of wav) binary += String.fromCharCode(byte);
  const audio = btoa(binary),
    { seconds } = validateWav(audio, check);
  return { audio, seconds };
}
