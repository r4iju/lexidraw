/// <reference types="bun" />
import { expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { default: env } = await import("@packages/env");
const HOST = new URL(env.VERCEL_BLOB_STORAGE_HOST).origin;

const stored = new Map<string, Date>();
const LONG_AGO = new Date("2026-01-01T00:00:00Z");
// `.env.test` carries a real store token, so nothing here may reach the store.
const realBlob = await import("@vercel/blob");
mock.module("@vercel/blob", () => ({
  ...realBlob,
  list: async () => ({
    blobs: [...stored].map(([pathname, uploadedAt]) => ({
      pathname,
      url: `${HOST}/${pathname}`,
      uploadedAt,
    })),
    hasMore: false,
  }),
  del: async (urls: string | string[]) => {
    for (const url of [urls].flat()) {
      stored.delete(decodeURIComponent(new URL(url).pathname.slice(1)));
    }
  },
}));

const { cleanupOrphanedBlobsWorkflow } = await import(
  "./cleanup-orphaned-blobs-workflow"
);

const DOC = "cleanup_doc";

test("the cleanup deletes only blobs nothing refers to", async () => {
  await db.insert(schema.users).values({
    id: "cleanup_user",
    name: "Cleanup",
    email: "cleanup@example.test",
  });
  await db.insert(schema.entities).values({
    id: DOC,
    title: "Doc",
    elements: "{}",
    entityType: "document",
    userId: "cleanup_user",
    publicAccess: PublicAccess.PRIVATE,
    screenShotLight: `${HOST}/thumbnails/${DOC}/light-1.png`,
  });
  const image = (fileId: string, isDeleted: boolean) => ({
    type: "image",
    id: `cleanup-${fileId}`,
    fileId,
    isDeleted,
  });
  await db.insert(schema.entities).values({
    id: "cleanup_drawing",
    title: "Drawing",
    // A deleted element stays in the saved drawing, where undo finds it.
    elements: JSON.stringify([
      image("cleanup-file", false),
      image("cleanup-undone", true),
    ]),
    entityType: "drawing",
    userId: "cleanup_user",
    publicAccess: PublicAccess.PRIVATE,
    // In the trash, from where it can come back with its images.
    deletedAt: new Date(),
  });
  await db.insert(schema.uploadedImages).values({
    id: "cleanup_img",
    userId: "cleanup_user",
    entityId: DOC,
    fileName: `${DOC}-picture.png`,
    signedDownloadUrl: "",
  });
  await db.insert(schema.uploadedVideos).values({
    id: "cleanup_video",
    userId: "cleanup_user",
    entityId: DOC,
    fileName: `${DOC}-clip.mp4`,
    signedDownloadUrl: "",
  });
  await db.insert(schema.ttsJobs).values({
    id: "cleanup_tts",
    entityId: DOC,
    userId: "cleanup_user",
    status: "ready",
  });
  const live = [
    `thumbnails/${DOC}/light-1.png`,
    `${DOC}-picture.png`,
    `${DOC}-clip.mp4`,
    "tts/doc/cleanup_tts/manifest.json",
    "tts/doc/cleanup_tts/full.mp3",
    // Shared by every document that reads the same text, and read from
    // manifests rather than rows, so the cleanup cannot tell they are unused.
    "tts/chunks/cleanup-chunk.mp3",
    "backups/turso/lexidraw/2026/09/01/00-00-00-000.sqlite.gz",
    "drawings/cleanup_drawing/files/cleanup-file.png",
    "drawings/cleanup_drawing/files/cleanup-undone.png",
  ];
  const orphans = [
    `thumbnails/${DOC}/light-0.png`,
    "cleanup_gone-picture.png",
    "tts/doc/cleanup_gone/manifest.json",
    "tts/article/cleanup_gone/manifest.json",
    "drawings/cleanup_gone/files/cleanup-file.png",
    "drawings/cleanup_drawing/files/cleanup-unused.png",
  ];
  for (const pathname of [...live, ...orphans]) {
    stored.set(pathname, LONG_AGO);
  }
  // A new thumbnail is stored before its row points at it.
  const unrecorded = `thumbnails/${DOC}/light-2.png`;
  stored.set(unrecorded, new Date());
  // A file is stored before the element that shows it is saved.
  const unsaved = "drawings/cleanup_drawing/files/cleanup-unsaved.png";
  stored.set(unsaved, new Date(Date.now() - 2 * 60 * 60 * 1000));

  await cleanupOrphanedBlobsWorkflow();

  expect([...stored.keys()].toSorted()).toEqual(
    [...live, unrecorded, unsaved].toSorted(),
  );
});
