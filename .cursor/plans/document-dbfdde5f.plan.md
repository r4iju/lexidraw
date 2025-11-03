<!-- dbfdde5f-146a-4dd5-97c2-29087513880c 001134eb-1a56-4ba4-a874-fa125e060eac -->
# Document TTS via Markdown intermediary (sections + incremental regen)

### What we’ll build

- Convert the current document editor state to Markdown on the client using existing Lexical transformers.
- Server consumes Markdown, strips unsupported blocks (code/math/diagrams/media), splits by headings, batches to ~1–1.5k chars, and generates per‑chunk audio.
- Incremental regeneration via content hashes per chunk; unchanged chunks reuse existing audio; manifest rebuilt per run; optional stitched full audio.

### Server: markdown parsing + synthesis

- New `src/lib/markdown-for-tts.ts`
  - `sanitizeMarkdownForTts(md, opts)` → remove code fences (```/~~~), inline code (`), equations ($...$), images `![]()`, mermaid/diagram/code languages, and optionally tables.
  - `splitMarkdownIntoSections(md)` → returns ordered sections based on `^#{1,6}\s` headings, capturing `title`, `depth`, and section `body`.
  - `chunkSections(sections, { targetSize, hardCap })` → within each section, batch adjacent paragraphs to target size; return `DocChunk[] = { index, sectionTitle?, text }`.
  - `normalizeForTts(text)` → NFKC + whitespace collapse.

- New `src/server/tts/document-engine.ts`
  - `synthesizeDocumentFromMarkdown({ documentId, markdown, provider, voiceId, speed, format, languageCode, sampleRate, titleHint })`:
    - Build `docKey = sha256(documentId + provider + voiceId + speed + format + languageCode + sampleRate)`.
    - Run sanitize → split → chunk → normalize.
    - For each chunk: `chunkHash = sha256(normalizedText + provider + voiceId + speed + languageCode + (sampleRate||"") + "md-v1")`.
    - Store per-chunk audio at `tts/chunks/<chunkHash>.<fmt>`; HEAD-check; synthesize only misses (reuse provider selection, SSML, fallback logic from `engine.ts`).
    - Build `segments: { index, sectionTitle?, text, chunkHash, audioUrl }[]`.
    - Optional stitch: reuse ffmpeg/buffer concat to write `tts/doc/<docKey>/full.<fmt>`.
    - Write manifest `tts/doc/<docKey>/manifest.json` with `{ id: docKey, provider, voiceId, format, segments, totalChars, title, stitchedUrl }`.

- Types update `src/server/tts/types.ts`
  - Extend `TtsSegment` with optional `sectionTitle?: string` and `chunkHash?: string` (backward compatible).

### API: document endpoint

- New `src/app/api/documents/[documentId]/tts/route.ts`
  - Auth check; read `{ markdown?, provider?, voiceId?, speed?, format?, languageCode?, title? }`.
  - If an existing manifest for `docKey` exists, return it; otherwise schedule background `after(async () => synthesizeDocumentFromMarkdown(...))` and return `{ id, manifestUrl, status: "queued" }`.
  - If `markdown` is missing, respond 400 with guidance to trigger from the editor (v1 scope). Optional future: server‑side fallback from `entity.elements`.

- Optional: persist manifest pointer back to entity under `elements.tts` like existing article route.

### Client: trigger + playback

- Update `src/app/documents/[documentId]/plugins/options-dropdown.tsx`
  - Add "Generate audio" action: obtain Markdown via existing `convertEditorStateToMarkdown`, POST to `/api/documents/[documentId]/tts` with the Markdown and TTS config; if 202, poll `manifestUrl` until present.

- Reuse `src/components/audio/ArticleAudioPlayer.tsx`
  - Pass `segments`; display section labels if `sectionTitle` present.

### Behavior details

- Segmentation: split by headings; batch adjacent text nodes per section; fallback to paragraph batching when no headings.
- Skips: code/math/diagram/media nodes by default.
- Caching: per‑chunk audio keyed by content+voice config; cross‑document reuse.
- Budget guard: reuse cost estimation in `engine.ts` against total included chars.
- Versioning: include `"md-v1"` in `chunkHash` to safely invalidate on algorithm changes.

### File changes

- New: `apps/lexidraw/src/lib/markdown-for-tts.ts`
- New: `apps/lexidraw/src/server/tts/document-engine.ts`
- New: `apps/lexidraw/src/app/api/documents/[documentId]/tts/route.ts`
- Edit: `apps/lexidraw/src/server/tts/types.ts` (optional fields)
- Edit: `apps/lexidraw/src/app/documents/[documentId]/plugins/options-dropdown.tsx` (UI trigger)
- Optional: display `sectionTitle` in `ArticleAudioPlayer`

### Essential signatures

```ts
// markdown-for-tts.ts
export type DocChunk = { index: number; sectionTitle?: string; text: string };
export function sanitizeMarkdownForTts(md: string): string;
export function splitMarkdownIntoSections(md: string): { title?: string; depth: number; body: string }[];
export function chunkSections(
  sections: { title?: string; depth: number; body: string }[],
  opts?: { targetSize?: number; hardCap?: number }
): DocChunk[];
export function normalizeForTts(text: string): string;

// document-engine.ts
export async function synthesizeDocumentFromMarkdown(args: {
  documentId: string;
  markdown: string;
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

- [ ] Create sanitizeMarkdownForTts to drop code/math/media
- [ ] Implement splitMarkdownIntoSections using heading regex
- [ ] Batch section bodies into ~1400 char DocChunks
- [ ] Implement synthesizeDocumentFromMarkdown with per-chunk hashing & reuse
- [ ] Create /api/documents/[documentId]/tts route (POST markdown)
- [ ] Add optional sectionTitle and chunkHash to TtsSegment
- [ ] Add Generate audio in options-dropdown using Markdown export
- [ ] Display section labels in ArticleAudioPlayer if present
- [ ] Persist manifestUrl and segments in entity.elements.tts (optional)
- [ ] Apply cost estimation across included text and honor budget
- [ ] Reuse ffmpeg/buffer concat to write full document audio