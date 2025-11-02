<!-- dbfdde5f-146a-4dd5-97c2-29087513880c 6fb0e669-6e62-4da3-a5f3-c79bb1b6381f -->
# Document TTS (sections + incremental regen)

### What we’ll build

- Section-based TTS for documents using Lexical JSON, batching adjacent text blocks to ~1–1.5k chars per segment.
- Skip code/math/diagram/media nodes by default.
- Incremental regeneration via content hashes per chunk; unchanged chunks reuse existing audio; manifest rebuilt per run; optional stitched full audio.

### Server: chunking + synthesis

- New `src/lib/chunk-lexical.ts`
  - Implement `chunkLexicalDocument(json, { targetSize, hardCap, skipNodeTypes })`:
    - Walk Lexical JSON, collect sections split at headings (H1–H6), flatten textual descendants for include-types (paragraph, quote, list items, etc.), skip configured types (code, codeHighlight, mermaid, chart, figma, excalidraw, tweet, video, youtube, table, image, inlineImage, equation).
    - Within each section, batch adjacent blocks to target chars (~1400) with hard cap.
    - Normalize text for hashing and synthesis.

- New `src/lib/normalize-for-tts.ts`
  - `normalizeForTts(text)` → `text.normalize("NFKC").replace(/\s+/g, " ").trim()`.

- New `src/server/tts/document-engine.ts`
  - `synthesizeDocument({ documentId, elementsJson, provider, voiceId, speed, format, languageCode, sampleRate })`:
    - Build `docKey = sha256(documentId + provider + voiceId + speed + format + languageCode + sampleRate)`.
    - Chunk with `chunkLexicalDocument` (fallback to paragraph chunking if no headings found).
    - For each chunk, compute `chunkHash = sha256(normalizedText + provider + voiceId + speed + languageCode + (sampleRate||"") + engineVersion)`.
    - Per-chunk storage path: `tts/chunks/<chunkHash>.<fmt>`; HEAD check; synthesize and PUT only if missing (reuse current provider selection, SSML, fallback logic from `engine.ts`).
    - Build ordered `segments: { index, sectionTitle?, text, chunkHash, audioUrl }[]`.
    - Optional stitch: fetch in-order buffers and reuse existing `ffmpeg`/buffer concat code; write `tts/doc/<docKey>/full.<fmt>`.
    - Write manifest `tts/doc/<docKey>/manifest.json` with `{ id: docKey, provider, voiceId, format, segments, totalChars, title, stitchedUrl }`.
    - Return `{ ...manifest, manifestUrl }`.

- Types update `src/server/tts/types.ts`
  - Extend `TtsSegment` with optional `sectionTitle?: string` and `chunkHash?: string` (backward compatible).

### API: document endpoint

- New `src/app/api/documents/[documentId]/tts/route.ts`
  - Auth check; load entity by `documentId` and user; parse `entity.elements`.
  - Merge per-user TTS defaults (provider/voice/speed/format/languageCode/sampleRate) like existing TTS route.
  - HEAD-check manifest; if exists, return it with `manifestUrl`.
  - Else schedule background `after(async () => synthesizeDocument(...))` and return `{ id, manifestUrl, status: "queued" }`.
  - Kokoro behavior: mirror current (no caching in dev; allow reuse in prod later if desired).

- Optional: persist manifest pointer back to entity (like `app/api/tts/route.ts`) under `elements.tts` for quick retrieval.

### Client: trigger + playback

- Update `src/app/documents/[documentId]/plugins/options-dropdown.tsx`
  - Add "Generate audio" action with existing TTS control popover (provider, voice, speed, format, languageCode).
  - POST to `/api/documents/[documentId]/tts` with selected config; if 202, poll `manifestUrl` until present.

- Reuse player `src/components/audio/ArticleAudioPlayer.tsx`
  - Pass `segments`; optionally display section labels if `sectionTitle` present.

### Behavior details

- Segmentation: split by headings; batch adjacent text nodes per section; fallback to paragraph batching when no headings.
- Skips: code/math/diagram/media nodes; option to include later.
- Caching: per-chunk audio keyed by content+voice config; cross-document reuse.
- Budget guard: reuse existing cost estimation; compute total chars across included segments.
- Versioning: include `engineVersion` in `chunkHash` to safely invalidate on algorithm changes.

### File changes

- New: `apps/lexidraw/src/lib/chunk-lexical.ts`
- New: `apps/lexidraw/src/lib/normalize-for-tts.ts`
- New: `apps/lexidraw/src/server/tts/document-engine.ts`
- New: `apps/lexidraw/src/app/api/documents/[documentId]/tts/route.ts`
- Edit: `apps/lexidraw/src/server/tts/types.ts` (optional segment fields)
- Edit: `apps/lexidraw/src/app/documents/[documentId]/plugins/options-dropdown.tsx` (UI trigger)
- Optional: `ArticleAudioPlayer` small tweak to display section labels

### Small, essential signatures

```ts
// chunk-lexical.ts
export type DocChunk = { index: number; sectionTitle?: string; text: string };
export function chunkLexicalDocument(
  elementsJson: unknown,
  opts?: { targetSize?: number; hardCap?: number; skipNodeTypes?: string[] }
): DocChunk[]

// document-engine.ts
export async function synthesizeDocument(args: {
  documentId: string;
  elementsJson: unknown;
  provider?: string;
  voiceId?: string;
  speed?: number;
  format?: "mp3"|"ogg"|"wav";
  languageCode?: string;
  sampleRate?: number;
  titleHint?: string;
}): Promise<TtsResult>
```

### To-dos

- [ ] Create chunkLexicalDocument to segment by headings and batch text
- [ ] Add normalizeForTts for stable hashing and synthesis input
- [ ] Implement synthesizeDocument with per-chunk hashing and reuse
- [ ] Create /api/documents/[documentId]/tts route with background job
- [ ] Add optional sectionTitle and chunkHash to TtsSegment
- [ ] Add Generate audio action to document options-dropdown
- [ ] Display section index/title in ArticleAudioPlayer if available
- [ ] Persist manifestUrl and segments in entity.elements.tts (optional)
- [ ] Apply cost estimation against document text and honor budget
- [ ] Reuse ffmpeg/buffer concat to write full audio for document