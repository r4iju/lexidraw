<!-- a9b0699b-d648-4a94-8517-e553ea4341a0 a36c7bda-4b17-45e0-88b0-ebe3e7d5ae1d -->
# Durable Thumbnail Queue (Turso + Next 15)

## 1) Schema & Migrations (packages/drizzle)

- Edit `packages/drizzle/src/drizzle-schema.ts`:
- New table `thumbnailJobs` with columns:
- `id` text PK (uuid), `entityId` text FK→`entities.id` ON DELETE CASCADE,
- `version` text, `status` text $type<'pending'|'processing'|'done'|'error'|'stale'>,
- `attempts` int default 0, `nextRunAt` integer({ mode:'timestamp_ms' }),
- `lastError` text null, `createdAt` integer ts, `updatedAt` integer ts.
- Indexes: unique(entityId, version), index(status, nextRunAt).
- Extend `entities` with:
- `thumbnailStatus` text $type<'pending'|'ready'|'error'> default 'pending'
- `thumbnailUpdatedAt` integer ts nullable
- `thumbnailVersion` text nullable
- Add migration `packages/drizzle/drizzle/0013_thumbnail_jobs.sql`:
- CREATE TABLE `ThumbnailJobs` (... as above ...)
- CREATE UNIQUE INDEX `ThumbnailJobs_entity_version_key` ON (`entityId`,`version`)
- CREATE INDEX `ThumbnailJobs_status_nextRunAt_idx` ON (`status`,`nextRunAt`)
- ALTER TABLE `Entities` ADD columns for status/updatedAt/version

## 2) Enqueue on Save (apps/lexidraw)

- File: `apps/lexidraw/src/server/api/routers/entities.ts`
- In `entityRouter.save`:
- Compute `version` (prefer stable hash): `md5(JSON.stringify({elements, appState}))` or `updatedAt.toISOString()`.
- Upsert into `thumbnailJobs` with `{ entityId: id, version, status:'pending', attempts:0, nextRunAt: new Date() }` (ignore conflict on unique).
- Update `entities` row: `thumbnailStatus:'pending', thumbnailVersion: version` (do not await processing).

## 3) Processor Cron Route

- New route: `apps/lexidraw/src/app/api/crons/process-thumbnail-jobs/route.ts`
- GET handler guarded by `canRunCron()`.
- Select up to N (e.g., 10) jobs where:
- `status IN ('pending','error')`
- `nextRunAt <= now()`
- `attempts < 5`
- For each job (transactionally):
- Load entity; if missing → mark job `stale` and continue.
- Staleness check: if `entity.thumbnailVersion !== job.version` OR `entity.updatedAt > job.createdAt` → mark `stale` and continue.
- Mark job `processing`, increment `attempts`, set `nextRunAt = now() + backoff(attempts)`.
- Build secure screenshot URL:
- Derive `appBase` from `x-forwarded-proto` + `host` (same pattern as existing regenerate route in `entities.ts`).
- Create token via `~/server/auth/screenshot-token#createScreenshotToken({ userId: entity.userId, entityId: job.entityId, ttlMs: 3*60_000 })`.
- `pageUrl = `${appBase}/screenshot/documents/${id}?st=${token}&width=640&height=480``
- Call render worker twice:
- POST to `${HEADLESS_RENDER_URL}/api/screenshot` with JSON `{ url: pageUrl, viewport:{ width:640,height:480,deviceScaleFactor:2 }, image:{ type:'webp', quality:92 }, waitUntil:'networkidle2', timeoutMs:15000, theme:'light' | 'dark' }`.
- Upload to Blob (server-side):
- `@vercel/blob` `put(`${entityId}-light.webp`, buffer, { access:'public', contentType:'image/webp', token: env.BLOB_READ_WRITE_TOKEN, addRandomSuffix:false })` (same for `-dark.webp`).
- Update `Entities` with URLs for `screenShotLight/ Dark`, set `thumbnailStatus:'ready'`, `thumbnailUpdatedAt: now()`, `thumbnailVersion: job.version`.
- Mark job `done`.
- On failure: set job `status:'error'`, persist `lastError`, keep `nextRunAt` to backoff value.
- Respond with summary JSON of processed/failed/stale counts.

### Backoff helper

- attempts→delay: 1→15s, 2→60s, 3→5m, 4→20m, 5→2h; cap 24h.

## 4) Dashboard UX

- File: `apps/lexidraw/src/app/dashboard/thumbnail-client.tsx`
- If `entity.thumbnailStatus === 'pending'`, render a semi‑transparent shimmer overlay on top of the image area.
- Optional: when pending, `setInterval` to `router.refresh()` every 8s until status != 'pending'.

## 5) Retry CTA

- Add a small server action (or tRPC mutation) to enqueue a new job for the current entity version when a user clicks retry on error. Do not reuse the failed job id to avoid unique constraint issues if content changed.

## 6) Observability

- Add `console.log` metrics for durations and error reasons in the cron route.
- Optional debug page/endpoint: list last 50 `ThumbnailJobs` with status + `lastError`.

## 7) Security

- Keep screenshot token short‑lived, scope `read-document` (reuse `~/server/auth/screenshot-token`).
- Render worker already blocks private hostnames in prod.

## 8) Rollout

1. Create schema + migration; run migrations.
2. Implement enqueue in save.
3. Add processor cron route and register it with your cron scheduler (every minute).
4. Update dashboard shimmer + optional polling.
5. (Optional) admin/debug list.

### To-dos

- [ ] Add ThumbnailJobs table and Entities thumbnail columns in schema + migration
- [ ] Enqueue job and set thumbnailStatus/version in entities.save
- [ ] Implement /api/crons/process-thumbnail-jobs cron worker with backoff/dedupe
- [ ] Upload light/dark images to Vercel Blob with deterministic keys
- [ ] Show shimmer while pending and optional polling in thumbnail client
- [ ] Add retry action to insert a new job for current version
- [ ] Log attempt durations and errors; add optional debug endpoint