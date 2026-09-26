/// <reference types="bun" />
import { afterAll, expect, test } from "bun:test";
import env from "@packages/env";
import {
  generateClientTokenFromReadWriteToken,
  put,
} from "@vercel/blob/client";
import { blobUploadRequest } from "./blob-upload";

/** Headers the store's client varies per request, which no caller repeats. */
const PER_REQUEST = new Set([
  "x-api-blob-request-id",
  "x-api-blob-request-attempt",
  "x-content-length",
  "content-length",
  "content-type",
  "host",
  "user-agent",
  "accept",
  "accept-encoding",
  "connection",
]);

const asked: { method: string; url: string; headers: Headers }[] = [];
const store = Bun.serve({
  port: 0,
  fetch: (request) => {
    const { method, url, headers } = request;
    asked.push({ method, url, headers });
    return Response.json({
      url: "https://store.test/a.png",
      downloadUrl: "https://store.test/a.png?download=1",
      pathname: "a.png",
      contentType: "image/png",
      contentDisposition: "inline",
    });
  },
});
const savedApi = process.env.VERCEL_BLOB_API_URL;
process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${store.port}/api/blob`;
afterAll(() => {
  store.stop(true);
  process.env.VERCEL_BLOB_API_URL = savedApi;
});

test("an app's upload is the request the store's own client makes", async () => {
  const pathname = "user-1-0b0e6c1e-2f6a-4d0e-9d0a-8a6f1f0e2b3c.png";
  const token = await generateClientTokenFromReadWriteToken({
    token: env.BLOB_READ_WRITE_TOKEN,
    pathname,
    allowedContentTypes: ["image/png"],
  });

  await put(pathname, new Blob([new Uint8Array([1, 2, 3])]), {
    access: "public",
    token,
    contentType: "image/png",
  });

  const [made] = asked;
  const described = blobUploadRequest(pathname, token, "image/png");
  expect(made).toMatchObject({
    method: described.method,
    url: described.url,
  });
  const kept = [...(made?.headers ?? [])].filter(
    ([name]) => !PER_REQUEST.has(name),
  );
  expect(Object.entries(described.headers).toSorted()).toEqual(kept.toSorted());
});
