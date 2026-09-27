import "server-only";
import type { TtsProvider, TtsSynthesizeInput } from "../types";
import { DEFAULT_GEMINI_VOICE, geminiVoice } from "~/lib/gemini-voices";
import { Mp3Encoder } from "@breezystack/lamejs";
import { FatalError, RetryableError } from "workflow";
import { refusal } from "./refusal";
import env from "@packages/env";

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
// Flash-Lite is Google's model for read-aloud; Flash is for voice acting.
const MODEL = "gemini-3.8-flash-lite-tts";

// Voice at Gemini's 24 kHz, mono, loses nothing audible at this rate.
const MP3_KBPS = 64;

/** The samples of a 16-bit mono WAV, which is all Gemini answers in. */
function pcmOf(wav: Buffer): { samples: Int16Array; sampleRate: number } {
  if (wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new FatalError("Gemini TTS answered with audio that is not WAV");
  }
  let sampleRate = 24000;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === "fmt ") sampleRate = wav.readUInt32LE(at + 12);
    if (id === "data") {
      const end = Math.min(wav.length, at + 8 + size) & ~1;
      const data = wav.subarray(at + 8, end);
      // Copied out, since a Buffer's bytes need not start 2-aligned.
      const samples = new Int16Array(data.length / 2);
      for (let i = 0; i < samples.length; i++)
        samples[i] = data.readInt16LE(i * 2);
      return { samples, sampleRate };
    }
    at += 8 + size + (size % 2);
  }
  throw new FatalError("Gemini TTS answered with a WAV holding no audio");
}

function mp3Of(wav: Buffer): Buffer {
  const { samples, sampleRate } = pcmOf(wav);
  const encoder = new Mp3Encoder(1, sampleRate, MP3_KBPS);
  const frames: Buffer[] = [];
  // Its types say Uint8Array; it hands back Int8Array.
  const bytes = (frame: ArrayBufferView) =>
    Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  const block = 1152 * 16;
  for (let at = 0; at < samples.length; at += block) {
    frames.push(bytes(encoder.encodeBuffer(samples.subarray(at, at + block))));
  }
  frames.push(bytes(encoder.flush()));
  return Buffer.concat(frames);
}

/**
 * How the voice reads. Gemini reads its text verbatim, so pace can only be
 * asked for here, and only roughly: it takes no rate. Gemini tells each
 * word's language apart itself, but without being asked, says a lone foreign
 * word (a heading, a dish) with the accent of the text around it.
 */
function styleFor(speed = 1): string {
  const pace =
    speed < 0.85
      ? ", speaking slowly"
      : speed < 0.95
        ? ", speaking a little slowly"
        : speed >= 1.25
          ? ", speaking quickly"
          : speed > 1.05
            ? ", speaking a little quickly"
            : "";
  return `clear, natural narration${pace}; pronounce each word from another language as a native speaker of that language would`;
}

type Interaction = {
  status?: string;
  steps?: {
    type?: string;
    content?: { type?: string; data?: string; mime_type?: string }[];
    error?: { message?: string };
  }[];
};

export function createGeminiTtsProvider(
  apiKeyFromUser?: string | null,
): TtsProvider {
  const apiKey = apiKeyFromUser || env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Google API key not configured");
  }

  return {
    name: "google",
    maxCharsPerRequest: 4000,
    supportsSsml: false,
    async synthesize(input: TtsSynthesizeInput) {
      // Settings serve Ogg as MP3 for Gemini; see servedFormat.
      if (input.format === "ogg") {
        throw new FatalError("Gemini TTS makes MP3 or WAV, not Ogg");
      }
      const voice = geminiVoice(input.voiceId) ?? DEFAULT_GEMINI_VOICE;
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
          "Api-Revision": "2026-05-20",
        },
        body: JSON.stringify({
          model: MODEL,
          input: [
            {
              type: "text",
              text: input.textOrSsml,
              annotations: [
                { type: "speech_metadata", style: styleFor(input.speed) },
              ],
            },
          ],
          // Flash-Lite refuses MP3 and Ogg Opus, so MP3 is made here.
          response_format: { type: "audio", mime_type: "audio/wav" },
          generation_config: { speech_config: [{ voice }] },
          // A document's text has no reason to stay with Google.
          store: false,
        }),
      });
      if (!res.ok) {
        const msg = await refusal("Gemini", res);
        if (res.status === 429) {
          const retryAfter =
            Number.parseInt(res.headers.get("Retry-After") ?? "", 10) || 10;
          throw new RetryableError(msg, { retryAfter });
        }
        if (res.status >= 400 && res.status < 500) {
          throw new FatalError(msg);
        }
        throw new Error(msg);
      }

      const interaction = (await res.json()) as Interaction;
      const outputs = (interaction.steps ?? []).filter(
        (step) => step.type === "model_output",
      );
      const audio = outputs
        .flatMap((step) => step.content ?? [])
        .find((content) => content.type === "audio" && content.data);
      if (!audio?.data) {
        const reason =
          outputs.find((step) => step.error)?.error?.message ??
          `status ${interaction.status ?? "unknown"}`;
        throw new Error(`Gemini TTS answered without audio (${reason})`);
      }
      const wav = Buffer.from(audio.data, "base64");
      return { audio: input.format === "mp3" ? mp3Of(wav) : wav };
    },
  };
}
