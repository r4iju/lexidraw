import "server-only";
import {
  and,
  type drizzle,
  eq,
  inArray,
  ne,
  notInArray,
  schema,
  sql,
} from "@packages/drizzle";
import env from "@packages/env";
import { del, list } from "@vercel/blob";
import { revalidateEntities } from "~/server/api/entity-cache";
import { blobErrorCode, isThumbnailOf } from "~/server/entities/thumbnail";

type Db = typeof drizzle;

/**
 * Removes an account and everything that is its own.
 *
 * The rows go in one atomic batch, which also reads which blobs they point
 * at, so a failure leaves the account whole rather than half gone. The blobs
 * go once the rows are, so nothing left can point at a missing one; any that
 * stay behind are orphans to `bucket-cleanup`.
 *
 * Deleting the user row and its entities cascades to what hangs off them:
 * sign-ins, sessions, tokens, shares either way, tags, preferences, uploads,
 * audio and thumbnail jobs, and live-editing rooms. What belongs to someone
 * else is moved out of the way first, so the cascade cannot reach it.
 */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  const own = db
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .where(eq(schema.entities.userId, userId));
  const others = db
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .where(ne(schema.entities.userId, userId));
  const emailOf = sql<string>`(select ${schema.users.email} from ${schema.users} where ${schema.users.id} = ${userId})`;
  const handToFileOwner = (
    table:
      | typeof schema.uploadedImages
      | typeof schema.uploadedVideos
      | typeof schema.ttsJobs,
  ) =>
    db
      .update(table)
      .set({
        userId: sql<string>`(select ${schema.entities.userId} from ${schema.entities} where ${schema.entities.id} = ${table.entityId})`,
      })
      .where(and(eq(table.userId, userId), inArray(table.entityId, others)));

  const [entities, rehomed, images, videos, audio] = await db.batch([
    db
      .select({
        id: schema.entities.id,
        parentId: schema.entities.parentId,
        light: schema.entities.screenShotLight,
        dark: schema.entities.screenShotDark,
      })
      .from(schema.entities)
      .where(eq(schema.entities.userId, userId)),
    // A file someone else kept in one of these folders would go with the
    // folder; it goes to its owner's top level instead.
    db
      .update(schema.entities)
      .set({ parentId: null })
      .where(
        and(
          ne(schema.entities.userId, userId),
          inArray(schema.entities.parentId, own),
        ),
      )
      .returning({ id: schema.entities.id }),
    db
      .select({ pathname: schema.uploadedImages.fileName })
      .from(schema.uploadedImages)
      .where(inArray(schema.uploadedImages.entityId, own)),
    db
      .select({ pathname: schema.uploadedVideos.fileName })
      .from(schema.uploadedVideos)
      .where(inArray(schema.uploadedVideos.entityId, own)),
    db
      .select({ id: schema.ttsJobs.id })
      .from(schema.ttsJobs)
      .where(inArray(schema.ttsJobs.entityId, own)),
    // What this account added to someone else's file is part of that file now.
    handToFileOwner(schema.uploadedImages),
    handToFileOwner(schema.uploadedVideos),
    handToFileOwner(schema.ttsJobs),
    // Tag names are shared, so only those nobody else uses go with it.
    db.delete(schema.tags).where(
      and(
        inArray(
          schema.tags.id,
          db
            .select({ id: schema.entityTags.tagId })
            .from(schema.entityTags)
            .where(eq(schema.entityTags.userId, userId)),
        ),
        notInArray(
          schema.tags.id,
          db
            .select({ id: schema.entityTags.tagId })
            .from(schema.entityTags)
            .where(
              and(
                ne(schema.entityTags.userId, userId),
                notInArray(schema.entityTags.entityId, own),
              ),
            ),
        ),
      ),
    ),
    db
      .delete(schema.verificationTokens)
      .where(eq(schema.verificationTokens.identifier, emailOf)),
    // The one reference to a user that does not cascade.
    db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId)),
    db.delete(schema.entities).where(eq(schema.entities.userId, userId)),
    db.delete(schema.users).where(eq(schema.users.id, userId)),
  ]);

  revalidateEntities(
    ...entities.flatMap((entity) => [entity.id, entity.parentId]),
    ...rehomed.map((entity) => entity.id),
  );

  await deleteBlobs(
    [
      ...entities.flatMap((entity) =>
        [entity.light, entity.dark].filter((url) =>
          isThumbnailOf(entity.id, url),
        ),
      ),
      ...images.map((image) => image.pathname),
      ...videos.map((video) => video.pathname),
    ],
    // Only a document's or an article's own audio: the chunks under
    // `tts/chunks/` are shared by every document that reads the same text.
    audio.flatMap((job) => [`tts/doc/${job.id}/`, `tts/article/${job.id}/`]),
  );
}

const DELETE_BATCH = 500;

async function deleteBlobs(
  urlsOrPathnames: string[],
  prefixes: string[],
): Promise<void> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  const doomed = [...urlsOrPathnames];
  try {
    for (const prefix of prefixes) {
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, token });
        doomed.push(...page.blobs.map((blob) => blob.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    }
    for (let at = 0; at < doomed.length; at += DELETE_BATCH) {
      await del(doomed.slice(at, at + DELETE_BATCH), { token });
    }
  } catch (error) {
    console.warn("[account] blobs of a deleted account left to the cleanup", {
      code: blobErrorCode(error),
    });
  }
}
