<!-- bd6bd88d-2c7f-42ff-8145-de5d8ee3f121 f75a51e5-4a2c-46b9-b6d2-0ea68f86323f -->
# Plan: Polish Article Node and Insertion Flows

### 1) Centralize tRPC usage for URL embeds

- Replace fetch in AutoEmbed with a command that delegates to `ArticlePlugin`.
- Update command to accept an optional preset URL, auto-extract on open.

Edits

- `apps/lexidraw/src/app/documents/[documentId]/plugins/ArticlePlugin/index.tsx`
- Change `INSERT_ARTICLE_URL_COMMAND` to `LexicalCommand<string | void>`.
- If payload is a string URL, immediately call `api.articles.extractFromUrl.mutateAsync({ url })` and insert (bypass dialog), otherwise open dialog as today.
- `apps/lexidraw/src/app/documents/[documentId]/plugins/AutoEmbedPlugin/index.tsx`
- In `ArticleEmbedConfig.insertNode`, dispatch `INSERT_ARTICLE_URL_COMMAND` with the matched URL; remove manual fetch.

### 2) Convert-to-text: preserve structure when versions are unified

- Current safe fallback uses plain text. Improve when Lexical versions are deduped.

Edits

- After dedupe (task 5), switch to:
- `const { $generateNodesFromDOM } = await import('@lexical/html')`
- `node.selectNext(); $insertNodes($generateNodesFromDOM(editor, dom)); node.remove();`
- Feature-guard: keep plain-text fallback if `$generateNodesFromDOM` signature mismatch occurs.

### 3) Server-side filter for saved-article picker

- Avoid client-side filtering after wide `entities.list`.

Edits

- `apps/lexidraw/src/server/api/routers/entities.ts`
- Extend `list` input with `entityTypes?: ('document'|'drawing'|'url')[]`.
- Add `inArray(schema.entities.entityType, input.entityTypes)` to WHERE when provided.
- `apps/lexidraw/src/app/documents/[documentId]/plugins/ArticlePlugin/index.tsx`
- Pass `{ entityTypes: ['url'] }` to `entities.list` hook.

### 4) ArticleNode exportDOM minimal attribute

- Reduce HTML bloat when copying/exporting.

Edits

- `apps/lexidraw/src/app/documents/[documentId]/nodes/ArticleNode/ArticleNode.tsx`
- `exportDOM` → only set `data-lexical-article="1"` and `data-article-mode` ("url"|"entity"). Remove JSON.

### 5) Lexical version dedupe

- Resolve 0.30 vs 0.37 type divergence so decorators/utilities interoperate cleanly.

Actions (no code inside repo):

- `apps/*/package.json`: pin `lexical`, `@lexical/*` to the same minor (e.g., 0.37.x).
- Run install and ensure one version in lockfile.
- Validate type compatibility in nodes/plugins.

### 6) Cleaner insertion semantics

- Use `$insertNodes` with selection rather than chaining `insertAfter`.

Edits

- `apps/lexidraw/src/app/documents/[documentId]/nodes/ArticleNode/ArticleBlock.tsx`
- In convert-to-text (post task 5), call `node.selectNext(); $insertNodes(nodes); node.remove();`.

### 7) Optional snapshot for entity inserts

- Faster initial paint; refresh pulls the latest.

Edits

- `apps/lexidraw/src/app/documents/[documentId]/plugins/ArticlePlugin/index.tsx`
- When inserting `mode:'entity'`, optionally fetch `entities.load` and set `snapshot` with distilled subset if present.

## Notes

- Keep ArticleEmbed last in AutoEmbed configs to preserve precedence of specific handlers (YouTube, Twitter, Figma).
- Ensure all new code uses tRPC hooks for network calls; no manual fetch.

### To-dos

- [ ] Add shared Article types in packages/types/src/article.ts
- [ ] Create articles tRPC router with extractFromUrl
- [ ] Implement ArticleNode and ArticleBlock UI
- [ ] Add ArticlePlugin with insert dialogs and commands
- [ ] Register ArticleNode in document-editor and toolbar/shortcuts
- [ ] Extend AutoEmbedPlugin to support article URLs
- [ ] Implement saved-article picker using entities.list filter
- [ ] Implement conversion using @lexical/html and remove node
- [ ] Wire refresh logic for URL and entity modes