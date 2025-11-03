<!-- 5b4d62dd-a724-4094-af53-5d5debc7e22e 07e30d1a-c809-493c-ac46-0efb3485ccc2 -->
# Persistent TTS Generation Toast with Progress Tracking

## Current Issues

- Toast shows success message immediately after mutation (before generation completes)
- No persistent feedback during generation
- Status changes (queued → processing → ready) aren't reflected in UI
- No visibility into progress as segments complete

## Implementation Plan

### 1. Update Workflow to Track Incremental Progress

**File**: `apps/lexidraw/src/workflows/document-tts.ts`

**Changes**:

- After each batch of segments completes (line ~120), update the database with current segment count
- Store `plannedCount` in database when job starts (for progress calculation)
- Create helper step `updateProgressStep(docKey, completedSegments, totalSegments)` to update `segmentCount` incrementally

**Key changes**:

```typescript
// After planChunksStep, store planned count
await updateJobStatusStep(docKey, documentId, "processing", planned.length);

// After each batch completes:
await updateProgressStep(docKey, results.length, planned.length);
```

**New step function**:

```typescript
async function updateProgressStep(
  docKey: string,
  completedSegments: number,
  totalSegments: number,
): Promise<void> {
  "use step";
  await drizzle
    .update(schema.ttsJobs)
    .set({ 
      segmentCount: completedSegments,
      updatedAt: new Date(),
    })
    .where(eq(schema.ttsJobs.id, docKey))
    .execute();
}
```

### 2. Update Database Schema (if needed)

**File**: `packages/drizzle/src/drizzle-schema.ts`

**Check if needed**:

- Ensure `ttsJobs.segmentCount` can be updated incrementally (it should already exist)
- May need to add `plannedCount` field to track total segments for progress calculation

**Alternative**: Calculate total from final manifest when ready, but this delays progress visibility.

### 3. Update Status Endpoint to Include Planned Count

**File**: `apps/lexidraw/src/server/api/routers/tts.ts`

**Changes**:

- Add `plannedCount` (or `totalSegments`) to `TtsJobSnapshot` type
- Return `plannedCount` from `getDocumentTtsStatus` query
- Use `segmentCount` / `plannedCount` to calculate progress percentage

### 4. Update TtsToolbar.tsx - Progress Toast with Progress Bar

**File**: `apps/lexidraw/src/app/documents/[documentId]/plugins/TtsToolbar.tsx`

**Changes**:

- Import `Progress` component from `~/components/ui/progress`
- Create toast with custom JSX content showing:
  - Status message ("Generating audio...")
  - Current segment count vs total (e.g., "3/15 segments")
  - Progress bar component
  - Spinner icon
- Update toast during polling with new progress values
- Convert to success toast when complete

**Key implementation**:

```typescript
const toastId = toast.loading(
  <div className="flex flex-col gap-2 w-full">
    <div className="flex items-center justify-between">
      <span>Generating audio...</span>
      <span className="text-sm text-muted-foreground">
        {completedSegments}/{totalSegments} segments
      </span>
    </div>
    <Progress value={(completedSegments / totalSegments) * 100} />
  </div>,
  { id: toastId, duration: Infinity }
);

// During polling, update with new progress:
const progress = snap.segmentCount ?? 0;
const total = snap.plannedCount ?? snap.segmentCount ?? 1;
toast.loading(
  <div className="flex flex-col gap-2 w-full">
    <div className="flex items-center justify-between">
      <span>Generating audio... ({snap.status})</span>
      <span className="text-sm text-muted-foreground">
        {progress}/{total} segments
      </span>
    </div>
    <Progress value={(progress / total) * 100} />
  </div>,
  { id: toastId, duration: Infinity }
);
```

### 5. Optional: Add Cancellation Support

**If workflows support cancellation**:

- Add cancel button to toast using sonner's `action` API
- Create `cancelDocumentTts` tRPC endpoint (if needed)
- Update toast to show "Cancelling..." when cancel is clicked
- Dismiss toast when cancelled

**Note**: This requires checking if workflow runs can be cancelled via workflow API. If not available, skip this step.

### 6. Toast Positioning & Styling

- Sonner defaults to bottom-right (configured in `components/ui/sonner.tsx`)
- Ensure toast persists until completion/cancellation
- Use `duration: Infinity` for loading toasts to prevent auto-dismissal
- Style progress bar to match theme (uses semantic tokens)

## Files to Modify

1. `apps/lexidraw/src/workflows/document-tts.ts` - Add incremental progress tracking
2. `packages/drizzle/src/drizzle-schema.ts` - Add plannedCount field (if needed)
3. `packages/drizzle/drizzle/XXXX_add_planned_count.sql` - Migration (if needed)
4. `apps/lexidraw/src/server/api/routers/tts.ts` - Add plannedCount to status response
5. `apps/lexidraw/src/app/documents/[documentId]/plugins/TtsToolbar.tsx` - Progress toast UI
6. (Optional) `apps/lexidraw/src/server/api/routers/tts.ts` - Add cancel endpoint if cancellation is supported

## Testing Considerations

- Verify toast appears immediately when generation starts
- Confirm progress updates as segments complete (0 → 1 → 2 → ... → total)
- Verify progress bar fills from 0% to 100%
- Confirm status updates reflect in toast message
- Ensure toast dismisses correctly on success/error
- Test cancellation flow (if implemented)
- Handle edge cases: total segments unknown initially, job cancelled mid-progress