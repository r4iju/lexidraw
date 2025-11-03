import "server-only";

export type TtsProviderName = "openai" | "google" | "kokoro";
export type TtsAudioFormat = "mp3" | "ogg" | "wav";

export type TtsSynthesizeInput = {
  textOrSsml: string;
  voiceId: string;
  speed?: number;
  format: TtsAudioFormat;
  sampleRate?: number;
  languageCode?: string;
  metadata?: Record<string, string>;
};

export interface TtsProvider {
  name: TtsProviderName;
  maxCharsPerRequest: number;
  supportsSsml: boolean;
  synthesize(input: TtsSynthesizeInput): Promise<{
    audio: Buffer;
    durationSec?: number;
  }>; // synthesize one chunk
}

export type TtsRequest = {
  url?: string;
  text?: string;
  provider?: TtsProviderName;
  voiceId?: string;
  speed?: number; // 0.25–4.0, defaults provider-specific
  format?: TtsAudioFormat; // default mp3
  languageCode?: string; // optional (Google)
  sampleRate?: number; // optional
};

export type TtsSegment = {
  index: number;
  text: string;
  ssml?: string;
  audioUrl?: string;
  durationSec?: number;
  sectionTitle?: string; // Section heading for document TTS
  chunkHash?: string; // Content hash for incremental regeneration
  sectionIndex?: number; // Zero-based index of section in document order
  headingDepth?: number; // 1-6 for headings
  sectionId?: string; // stable slug/hash id for the section
};

export type TtsResult = {
  id: string; // deterministic hash id
  provider: TtsProviderName;
  voiceId: string;
  format: TtsAudioFormat;
  segments: TtsSegment[];
  manifestUrl?: string;
  stitchedUrl?: string; // single-file audio if available (e.g., mp3)
  totalChars: number;
  title?: string;
};
