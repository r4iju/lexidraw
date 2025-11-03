<!-- 591337ec-3dfa-485a-9547-ca5fff2b2b9d ef8134cd-ca38-4caf-afad-f3fe43858cc3 -->
# Workflow Migration Analysis

## Current State

Workflows are already configured (`withWorkflow` in `next.config.ts`) and TTS workflows are successfully implemented:

- `generateDocumentTtsWorkflow` - handles document TTS generation
- `generateArticleTtsWorkflow` - handles article TTS generation

## High Priority Candidates

### 1. Thumbnail Jobs Cron (`/api/crons/process-thumbnail-jobs`)

**Current Implementation:**

- Location: `apps/lexidraw/src/app/api/crons/process-thumbnail-jobs/route.ts`
- Pattern: Polls database for jobs, processes in batches (limit 10), manual retry logic with exponential backoff
- Issues:
- Manual retry logic with `backoffDelayMs()` function
- Status tracking via database (`pending`, `processing`, `done`, `error`, `stale`)
- Cron endpoint must run periodically to process jobs
- No durability if processing fails mid-job
- Timeout risk on long-running batches

**Benefits of Workflow Migration:**

- Automatic retries with built-in backoff
- Per-job durability (each thumbnail job becomes its own workflow)
- No need for cron polling - jobs can be triggered immediately when queued
- Better observability via workflow UI
- Individual job isolation (one failure doesn't affect others)

**Migration Strategy:**

- Create `generateThumbnailWorkflow(entityId: string, version: string)` 
- Convert cron endpoint to trigger workflows for pending jobs (or trigger workflow directly when job is created)
- Steps: validate job → render screenshots → upload blobs → update entity → mark job done
- Use `getStepMetadata().stepId` for idempotency

**Files to Modify:**

- `apps/lexidraw/src/app/api/crons/process-thumbnail-jobs/route.ts` - convert to workflow trigger
- `apps/lexidraw/src/server/api/routers/entities.ts` - trigger workflow when saving entity (line 153-195)
- Create new workflow: `apps/lexidraw/src/workflows/thumbnail/generate-thumbnail-workflow.ts`

### 2. Bucket Cleanup Cron (`/api/crons/bucket-cleanup`)

**Current Implementation:**

- Location: `apps/lexidraw/src/app/api/crons/bucket-cleanup/route.ts`
- Pattern: Processes all blobs in batches of 500, has 800s timeout
- Issues:
- Single long-running operation with timeout risk
- No retry logic if cleanup fails partway
- Processes everything in one run - can't resume from failure point
- No per-blob granularity

**Benefits of Workflow Migration:**

- Break into smaller workflows per batch or per blob
- Automatic retries for failed deletions
- Can resume from last successful point
- Better observability of cleanup progress

**Migration Strategy:**

- Create `cleanupOrphanedBlobsWorkflow(cursor?: string)` 
- Process batches of blobs in steps
- Use cursor pagination within workflow
- Can run multiple workflow instances in parallel for different blob prefixes

**Files to Modify:**

- `apps/lexidraw/src/app/api/crons/bucket-cleanup/route.ts` - convert to workflow trigger
- Create new workflow: `apps/lexidraw/src/workflows/cleanup/bucket-cleanup-workflow.ts`

## Medium Priority Candidates (not in current plan)

### 3. Video Download Service (`apps/media-downloader`)

**Current Implementation:**

- Location: `apps/media-downloader/src/index.ts`
- Pattern: Background async processing with manual error handling
- Issues:
- Fire-and-forget background processing
- Manual status tracking in database
- No built-in retry logic
- Errors can be lost if process crashes

**Benefits of Workflow Migration:**

- Durable download/upload operations
- Automatic retries for transient failures
- Better error tracking and observability

**Migration Strategy:**

- Would require integrating workflow SDK into the Elysia service
- Create `downloadVideoWorkflow(url: string, userId: string, entityId: string)` 
- Steps: download → upload to blob → update database

**Note:** This is a separate service, so migration would require more setup.

## Low Priority / Already Optimized

### 4. TTS Operations

- Already using workflows ✅

### 5. Other TRPC Mutations

- Most are synchronous operations (create, update, delete)
- `downloadAndUploadByUrl` is synchronous HTTP request
- No clear benefit from workflow migration

## Recommended Implementation Order

1. **Thumbnail Jobs** - Highest impact, solves real pain points (manual retries, polling)
2. **Bucket Cleanup** - Medium impact, improves reliability
3. **Video Download** - Lower priority, requires more architectural changes not for this phase

## Key Implementation Patterns

Based on existing TTS workflows:

- Use `"use workflow"` for orchestration
- Use `"use step"` for I/O operations
- Make steps idempotent using `getStepMetadata().stepId`
- Use `start()` from `workflow/api` for fire-and-forget
- Handle errors with `FatalError` and `RetryableError`

## Implementation phases

1. Thumbnail Jobs Cron

2. Bucket Cleanup Cron

### To-dos

- [ ] Analyze thumbnail job workflow requirements and design step structure
- [ ] Analyze bucket cleanup workflow requirements and batch processing strategy