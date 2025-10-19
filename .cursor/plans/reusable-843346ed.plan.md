<!-- 843346ed-8c8d-4952-81db-46627ecb418c 898a43a2-ed76-4f23-845c-ee9ca6ad9158 -->
# Persist Preferred Playback Speed in User Config

### Summary

- Add `audio.preferredPlaybackRate` to `users.config` JSON type.
- Create config endpoints to read/update audio settings for authenticated users.
- Make `AudioPlayer` load preferred rate and persist updates on slider commit.

### Server changes

- Update `packages/drizzle/src/drizzle-schema.ts` `users.config` type:
  - Add `audio?: { preferredPlaybackRate?: number }`.
- In `apps/lexidraw/src/server/api/routers/config.ts`:
  - Add `AudioConfigSchema = z.object({ preferredPlaybackRate: z.number().min(0.5).max(3).default(1) })`.
  - Add `getAudioConfig` (protected): read `users.config.audio`, return `{ preferredPlaybackRate: 1 }` if absent.
  - Add `updateAudioConfig` (protected): merge into existing `users.config` (do NOT overwrite other keys):
    ```ts
    await ctx.drizzle.update(schema.users)
      .set({ config: { ...(current?.config ?? {}), audio: { preferredPlaybackRate: input.preferredPlaybackRate } } })
      .where(eq(schema.users.id, ctx.session.user.id));
    ```


### Client changes

- In `apps/lexidraw/src/components/ui/audio-player.tsx`:
  - Import `api` from `~/trpc/react`.
  - On mount, query `api.config.getAudioConfig.useQuery()` and set `rate` once data arrives (if different).
  - On speed slider commit (`onValueCommit`), call `api.config.updateAudioConfig.mutate({ preferredPlaybackRate: next })`.
  - Do not use localStorage; unauthenticated users simply won’t persist.
  - Optional prop `persistPreferredRate?: boolean` (default true) to opt out per-usage if needed.

### Behavior

- Initial `rate` = preferred from server if available; else default existing value.
- When switching segments, `audio.playbackRate` is re-applied (already implemented).
- Save occurs only on slider commit/release.

### To-dos

- [ ] Add audio.preferredPlaybackRate to users.config type
- [ ] Add config.getAudioConfig protected query
- [ ] Add config.updateAudioConfig protected mutation
- [ ] Read preferred rate in AudioPlayer and set initial rate
- [ ] Persist rate on speed slider commit in AudioPlayer
- [ ] Ensure unauthenticated users don’t persist or error UI