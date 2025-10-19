import "server-only";

export type TtsProviderName = "openai" | "google";
export type TtsAudioFormat = "mp3" | "ogg" | "wav";

export type TtsSynthesizeInput = {
  textOrSsml: string;
  voiceId: string;
  speed?: number;
  format: TtsAudioFormat;
  sampleRate?: number;
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
};

export type TtsSegment = {
  index: number;
  text: string;
  ssml?: string;
  audioUrl?: string;
  durationSec?: number;
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

export type UserProviderKeys = {
  openaiApiKey?: string | null;
  googleApiKey?: string | null;
};
