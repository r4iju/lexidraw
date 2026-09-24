/**
 * Where a listing loads an entity's thumbnail from. Every render overwrites
 * the same blob path, so the URL carries when the picture was stored: that,
 * not the content's revision, is what a cached copy has to be newer than.
 */
export function thumbnailSrc(
  base: string,
  entity: { updatedAt: Date; thumbnailUpdatedAt: Date | null },
): string {
  const stored = entity.thumbnailUpdatedAt ?? entity.updatedAt;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}v=${stored.getTime()}`;
}
