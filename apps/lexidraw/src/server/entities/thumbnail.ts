import { del } from "@vercel/blob";
import env from "@packages/env";
import { type drizzle, and, eq, inArray, or, schema } from "@packages/drizzle";

type Db = typeof drizzle;
type Shots = { light?: string; dark?: string };

/**
 * Where a new thumbnail blob of an entity goes: a path no earlier upload had.
 * The blob CDN ignores the query string and is slow to pick up an overwrite,
 * so a picture at a reused path can outlive its replacement in every cache in
 * front of it. Call it once per upload attempt, so a retry does not land on
 * the path of the attempt before it.
 */
export function thumbnailPathname(
  entityId: string,
  label: string,
  extension: string,
): string {
  return `thumbnails/${entityId}/${label}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
}

const BLOB_HOSTS = new Set(
  [env.VERCEL_BLOB_STORAGE_HOST, env.VERCEL_BLOB_STORAGE_HOST_DEV].map(
    (host) => new URL(host).host,
  ),
);

/**
 * Whether a URL is a blob named by {@link thumbnailPathname} for this entity.
 * Only those are deleted when replaced: a writer may point a thumbnail at any
 * URL, such as an image a document embeds, and replacing that must not delete
 * it.
 */
export function isThumbnailOf(entityId: string, url: string): boolean {
  try {
    const { host, pathname } = new URL(url);
    return (
      BLOB_HOSTS.has(host) &&
      decodeURIComponent(pathname).startsWith(`/thumbnails/${entityId}/`)
    );
  } catch {
    return false;
  }
}

/**
 * Sets an entity's thumbnail columns, with `columns` in the same write, and
 * deletes the thumbnail blobs this replaced once no entity shows them.
 */
export async function storeThumbnail(
  db: Db,
  entityId: string,
  shots: Shots,
  columns: Partial<typeof schema.entities.$inferInsert> = {},
  expectedVersion?: string,
): Promise<void> {
  const [before] = await db
    .select({
      light: schema.entities.screenShotLight,
      dark: schema.entities.screenShotDark,
    })
    .from(schema.entities)
    .where(eq(schema.entities.id, entityId));

  const stored = await db
    .update(schema.entities)
    .set({ ...columns, ...thumbnailColumns(shots) })
    .where(
      and(
        eq(schema.entities.id, entityId),
        expectedVersion === undefined
          ? undefined
          : eq(schema.entities.thumbnailVersion, expectedVersion),
      ),
    )
    .returning({ id: schema.entities.id });
  // An older workflow may finish after a newer one; its unused uploads are
  // collected by the bucket cleanup, while the current thumbnail stays put.
  if (stored.length === 0) return;

  const kept = new Set([shots.light, shots.dark]);
  const replaced = [
    ...new Set([
      shots.light === undefined ? undefined : before?.light,
      shots.dark === undefined ? undefined : before?.dark,
    ]),
  ].filter(
    (url): url is string =>
      !!url && !kept.has(url) && isThumbnailOf(entityId, url),
  );
  if (replaced.length === 0) return;

  const stillShown = await db
    .select({
      light: schema.entities.screenShotLight,
      dark: schema.entities.screenShotDark,
    })
    .from(schema.entities)
    .where(
      or(
        inArray(schema.entities.screenShotLight, replaced),
        inArray(schema.entities.screenShotDark, replaced),
      ),
    );
  const shown = new Set(stillShown.flatMap((row) => [row.light, row.dark]));
  const orphans = replaced.filter((url) => !shown.has(url));
  if (orphans.length === 0) return;

  try {
    await del(orphans, { token: env.BLOB_READ_WRITE_TOKEN });
  } catch (error) {
    // The thumbnail is stored; a blob left behind is the hourly
    // `bucket-cleanup` cron's to collect.
    console.warn("[thumbnail] replaced blob not deleted", {
      entityId,
      code: blobErrorCode(error),
    });
  }
}

/** `@vercel/blob` says what went wrong by the error's class, not a code. */
function blobErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  return error.constructor.name;
}

/**
 * The columns a write of an entity's thumbnail sets. `thumbnailUpdatedAt`
 * says when the picture was stored, and none of them moves `updatedAt`, which
 * is the content's revision.
 */
function thumbnailColumns(shots: Shots): {
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
