/**
 * The columns a write of an entity's thumbnail sets. Listings cache-bust a
 * thumbnail on `thumbnailUpdatedAt` (see `app/dashboard/thumbnail-src.ts`),
 * and several writers overwrite the same blob path, so every one of them
 * says when the picture was stored — and none moves `updatedAt`, which is
 * the content's revision.
 */
export function thumbnailColumns(shots: { light?: string; dark?: string }): {
  screenShotLight?: string;
  screenShotDark?: string;
  thumbnailUpdatedAt: Date;
} {
  return {
    ...(shots.light === undefined ? {} : { screenShotLight: shots.light }),
    ...(shots.dark === undefined ? {} : { screenShotDark: shots.dark }),
    thumbnailUpdatedAt: new Date(),
  };
}
