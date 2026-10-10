import { expect, test } from "bun:test";
import { createPrivateImageStore } from "./private-image-store";
import { fixtureImage } from "~/test/image-fixture";
const path = "generated-images/11111111-1111-4111-8111-111111111111.png";
test("private storage uploads only private PNG and reads a fixed origin without redirects or client credentials", async () => {
  const png = Buffer.from(fixtureImage().base64, "base64");
  let options: unknown, request: Request | undefined;
  const store = createPrivateImageStore(
    { storeId: "fixture", token: "synthetic-storage-token" },
    {
      async put(_path, _bytes, opts) {
        options = opts;
        return { url: "https://private-origin.test/never-expose" };
      },
      async del() {},
      async fetch(input, init) {
        request = new Request(input, init);
        return new Response(png, {
          headers: {
            "content-type": "image/png",
            "content-length": String(png.length),
          },
        });
      },
    },
  );
  await store.put(path, png);
  expect(options).toMatchObject({
    access: "private",
    contentType: "image/png",
    token: "synthetic-storage-token",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  expect(await store.read(path)).toEqual(png);
  expect(request?.url).toBe(
    `https://fixture.private.blob.vercel-storage.com/${path}`,
  );
  expect(request?.redirect).toBe("error");
  expect(request?.headers.get("authorization")).toBe(
    "Bearer synthetic-storage-token",
  );
  expect(request?.headers.get("cookie")).toBeNull();
  await expect(store.read("https://evil.test/image.png")).rejects.toThrow();
  await expect(store.read("generated-images/../escape.png")).rejects.toThrow();
});
test("private object reads reject redirects, non-PNG, oversized metadata and oversized or truncated streams", async () => {
  let response = new Response(null, {
    status: 302,
    headers: { location: "https://evil.test" },
  });
  const store = createPrivateImageStore(
    { storeId: "fixture", token: "synthetic" },
    {
      async put() {
        return { url: "ignored" };
      },
      async del() {},
      async fetch() {
        return response;
      },
    },
  );
  for (const next of [
    response,
    new Response("<svg/>", {
      headers: { "content-type": "image/svg+xml", "content-length": "6" },
    }),
    new Response("x", {
      headers: { "content-type": "image/png", "content-length": "2097153" },
    }),
    new Response(new Uint8Array(2097153), {
      headers: { "content-type": "image/png", "content-length": "1" },
    }),
    new Response("x", {
      headers: { "content-type": "image/png", "content-length": "2" },
    }),
  ]) {
    response = next;
    await expect(store.read(path)).rejects.toThrow();
  }
  response = new Response(null, { status: 404 });
  expect(await store.read(path)).toBeNull();
});
