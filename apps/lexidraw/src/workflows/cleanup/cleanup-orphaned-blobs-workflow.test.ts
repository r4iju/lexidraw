/// <reference types="bun" />
import { expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { default: env } = await import("@packages/env");
const HOST = new URL(env.VERCEL_BLOB_STORAGE_HOST).origin;

const stored = new Set<string>();
// `.env.test` carries a real store token, so nothing here may reach the store.
const realBlob = await import("@vercel/blob");
mock.module("@vercel/blob", () => ({
  ...realBlob,
  list: async () => ({
    blobs: [...stored].map((pathname) => ({
      pathname,
      url: `${HOST}/${pathname}`,
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
  ];
  const orphans = [
    `thumbnails/${DOC}/light-0.png`,
    "cleanup_gone-picture.png",
    "tts/doc/cleanup_gone/manifest.json",
    "tts/article/cleanup_gone/manifest.json",
  ];
  for (const pathname of [...live, ...orphans]) stored.add(pathname);

  await cleanupOrphanedBlobsWorkflow();

  expect([...stored].toSorted()).toEqual(live.toSorted());
});
