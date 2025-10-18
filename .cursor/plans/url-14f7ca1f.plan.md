<!-- 14f7ca1f-900a-48f8-b564-41729182b54f c29752f6-52fb-4a50-9cbf-74aadadaf54a -->
# URL Entity Article Distillation — MVP and Phase 2

## Overview

Implement a manual “Distill article” workflow for `entityType: "url"` that:

- Fetches the target URL server-side, extracts main content via Mozilla Readability, sanitizes HTML, normalizes links, and saves results into `Entities.elements`.
- Adds a button in the URL editor to trigger distillation and preview the article.

## Existing Integration Points

- DB schema (store in `Entities.elements` JSON):
```247:256:packages/drizzle/src/drizzle-schema.ts
export const entities = sqliteTable(
  "Entities",
  {
    id: text("id").primaryKey().notNull(),
    title: text("title").notNull(),
    elements: text("elements").notNull(),
    appState: text("appState"),
    entityType: text("entityType").notNull().default("drawing"), // drawing | document | directory | url
```

- URL creation flow:
```36:45:apps/lexidraw/src/app/urls/[urlId]/page.tsx
if (isNew === "true") {
  await api.entities.create.mutate({
    id: urlId,
    title: "New link",
    entityType: "url",
    elements: JSON.stringify({ url: "" }),
    parentId: parentId ?? null,
  });
  return redirect(`/urls/${urlId}`);
}
```

- URL editor (extend to add Distill button and preview):
```16:36:apps/lexidraw/src/app/urls/[urlId]/url-editor.tsx
export default function UrlEditor({ entity }: Props) {
  const initial = useMemo
    try {
      const parsed = JSON.parse(entity.elements ?? "{}") as { url?: string };
      return parsed.url ?? "";
    } catch {
      return "";
    }
;
```


## Data Model (MVP)

- Store results inside `Entities.elements` JSON, merged with existing fields.
```json
{
  "url": "https://example.com/article",
  "distilled": {
    "status": "ready", // "processing" | "failed"
    "title": "Article title",
    "byline": "Author Name",
    "siteName": "example.com",
    "lang": "en",
    "wordCount": 1342,
    "excerpt": "Short summary or first paragraph…",
    "contentHtml": "<article>…sanitized html…</article>",
    "images": [{ "src": "https://…", "alt": "", "width": 1200, "height": 800 }],
    "datePublished": "2025-01-01T12:00:00.000Z",
    "updatedAt": "2025-01-01T12:34:56.000Z"
  }
}
```


## Server (MVP)

1. Dependencies (apps/lexidraw):

   - `jsdom`, `@mozilla/readability`, `sanitize-html`.

2. Extractor util (server-only):

   - `apps/lexidraw/src/server/extractors/article.ts`
   - Exports `extractAndSanitizeArticle({ url, html? }): Promise<Distilled>`
   - Steps:
     - Fetch with timeout and size cap; only allow http/https; reject private IPs (basic SSRF guard).
     - Build JSDOM; run Readability; fallback to OpenGraph/`<meta>` for title/description when needed.
     - Sanitize with `sanitize-html` (whitelist headings, paragraphs, lists, images, links, blockquotes, code).
     - Rewrite relative URLs → absolute based on page URL; drop inline event handlers; add `rel="nofollow noopener noreferrer"` to links.
     - Collect simple image metadata from DOM.

3. tRPC procedure:

   - Add to `apps/lexidraw/src/server/api/routers/entities.ts`:
     - `distillUrl`: input `{ id: string, force?: boolean }`.
     - Loads entity, reads `elements.url`, runs extractor.
     - Merges distilled payload into `elements` and saves via existing update flow.
     - Returns distilled summary for UI.

## UI (MVP)

1. Add a “Distill article” button in `apps/lexidraw/src/app/urls/[urlId]/url-editor.tsx`:

   - Disabled when URL invalid or empty.
   - Calls `api.entities.distillUrl.mutate({ id })`.
   - Shows toasts for success/error.

2. Article preview panel (same page):

   - New client component `ArticlePreview` in `apps/lexidraw/src/app/urls/[urlId]/ArticlePreview.tsx`.
   - Renders `elements.distilled.contentHtml` via `dangerouslySetInnerHTML` (already sanitized server-side) inside a styled container using semantic tokens (no globals.css edits). Include Open link and Re-distill actions.

3. Surface distilled meta: title/byline/site, word count, updatedAt.

## Security & Reliability (MVP)

- Validate incoming URLs (protocol allowlist, length limits).
- Fetch with `AbortSignal.timeout`, size limit (e.g., 5–8 MB), and conservative User-Agent.
- Block private IP ranges and `file:`/`data:`/`ftp:` schemes; do not execute JS.
- Respect legal constraints: do not bypass paywalls; store only what fetch returns.
- Log extraction outcome (success/failure + timing).

## Testing (MVP)

- Unit test extractor with fixtures (simple blog, image-heavy, paywalled placeholder, script-heavy, non-article page).
- Integration test tRPC mutation with mocked fetch.
- UI smoke test: button → mutation → preview render.

## Phase 2 and Beyond (Outline)

- Background jobs: queue auto-distillation on first save; retry/backoff; progress UI.
- Offline durability: snapshot original HTML and distilled HTML to object storage; store keys in `elements.distilled.storage`.
- Image normalization: proxy/cache images; lazy-load; responsive `srcset`.
- Embed policy: sandbox/replace heavy embeds; safe iframe allowlist.
- Reader preferences: font/size/spacing/theme toggles applied client-side; persist per-user.
- Quality: fallback extractor (e.g., Unfluff) and heuristics tuning; language detection; reading-time.
- Re-distill on change: schedule periodic checks; hash-based change detection.
- Observability: metrics (success rate, time, word count), structured logs.

### To-dos

- [ ] Add jsdom, @mozilla/readability, sanitize-html to apps/lexidraw
- [ ] Create extractor util extractAndSanitizeArticle with Readability + sanitize
- [ ] Add entities.distillUrl mutation to run extractor and persist elements
- [ ] Enforce URL protocol allowlist, timeout, size cap, private IP block
- [ ] Add Distill button to url-editor; call entities.distillUrl
- [ ] Implement ArticlePreview rendering sanitized HTML and meta
- [ ] Merge distilled payload into elements JSON with updatedAt/status
- [ ] Add extractor unit tests, tRPC integration test, and UI smoke test
- [ ] Document usage, edge cases, and legal constraints in README