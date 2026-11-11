import { describe, expect, mock, test } from "bun:test";
import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import loadCustomRoutes from "next/dist/lib/load-custom-routes";

const env = {
  NODE_ENV: "production",
  VERCEL_URL: "lexidraw.test",
  SUPABASE_S3_ENDPOINT: "https://abc.supabase.co/storage/v1/s3",
  VERCEL_BLOB_STORAGE_HOST: "https://prod.public.blob.vercel-storage.com/",
  VERCEL_BLOB_STORAGE_HOST_DEV: "https://dev.public.blob.vercel-storage.com/",
  NEXT_PUBLIC_CODE_MODE_RUNNER_URL: "https://runner.example.org/sandbox.html",
  REACT_SCAN_ENABLED: false,
};
mock.module("@packages/env", () => ({ default: env }));

/** The headers Next sends for `path`, resolved the way its router does. */
async function headersFor(path: string) {
  const { default: nextConfig } = await import("./next.config");
  const config = await nextConfig("phase-production-server", {
    defaultConfig: {},
  });
  const { headers } = await loadCustomRoutes(config);
  const sent = new Map<string, string>();
  for (const route of headers.map((h) => buildCustomRoute("header", h))) {
    if (!new RegExp(route.regex).test(path)) continue;
    for (const { key, value } of route.headers)
      sent.set(key.toLowerCase(), value);
  }
  return sent;
}

function directives(policy: string | undefined) {
  return new Map(
    (policy ?? "")
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name as string, sources]),
  );
}

const pages = [
  "/",
  "/dashboard",
  "/documents/0b6f3c52-3c1e-4a58-9d0e-3f1d2c4b5a69",
  "/drawings/0b6f3c52-3c1e-4a58-9d0e-3f1d2c4b5a69",
  "/screenshot/documents/0b6f3c52-3c1e-4a58-9d0e-3f1d2c4b5a69",
  "/screenshot/view/0b6f3c52-3c1e-4a58-9d0e-3f1d2c4b5a69",
  "/signin",
  "/apiary",
];
const apiRoutes = ["/api", "/api/trpc/entity.list", "/api/fonts", "/api/v1/x"];

describe("page responses", () => {
  test.each(pages)("%s refuses framing by other origins", async (path) => {
    const sent = await headersFor(path);
    expect(sent.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(sent.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  test.each(pages)("%s is never sniffed", async (path) => {
    expect((await headersFor(path)).get("x-content-type-options")).toBe(
      "nosniff",
    );
  });

  test.each(pages)("%s sends only the origin to other sites", async (path) => {
    expect((await headersFor(path)).get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  test.each(pages)("%s carries a report-only policy", async (path) => {
    const policy = (await headersFor(path)).get(
      "content-security-policy-report-only",
    );
    expect(policy).toBeDefined();
  });
});

describe("native sign-in", () => {
  test("refuses all framing, same origin included", async () => {
    const sent = await headersFor("/native-sign-in");
    expect(sent.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(sent.get("x-frame-options")).toBe("DENY");
    expect(sent.get("x-content-type-options")).toBe("nosniff");
    expect(sent.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});

describe("API responses", () => {
  test.each(apiRoutes)("%s is never sniffed", async (path) => {
    expect((await headersFor(path)).get("x-content-type-options")).toBe(
      "nosniff",
    );
  });

  test.each(apiRoutes)("%s enforces nothing beyond framing", async (path) => {
    const sent = await headersFor(path);
    expect(sent.get("content-security-policy-report-only")).toBeUndefined();
    expect([undefined, "frame-ancestors 'self'"]).toContain(
      sent.get("content-security-policy"),
    );
  });
});

describe("the report-only policy", () => {
  const reportOnly = async () =>
    directives(
      (await headersFor("/documents/x")).get(
        "content-security-policy-report-only",
      ),
    );

  test("covers every kind of load, defaulting to same origin", async () => {
    const policy = await reportOnly();
    expect(policy.get("default-src")).toEqual(["'self'"]);
    for (const name of [
      "script-src",
      "style-src",
      "img-src",
      "media-src",
      "font-src",
      "frame-src",
      "worker-src",
      "connect-src",
    ])
      expect(policy.get(name)?.[0]).toBe("'self'");
  });

  test("has no reporting endpoint", async () => {
    const policy = await reportOnly();
    expect(policy.has("report-uri")).toBe(false);
    expect(policy.has("report-to")).toBe(false);
  });

  test("does not repeat the enforced frame-ancestors", async () => {
    expect((await reportOnly()).has("frame-ancestors")).toBe(false);
  });

  test("lets embeds load", async () => {
    const policy = await reportOnly();
    expect(policy.get("frame-src")).toEqual(
      expect.arrayContaining([
        "https://www.youtube-nocookie.com",
        "https://www.figma.com",
        "https://platform.twitter.com",
        "https://runner.example.org",
      ]),
    );
    expect(policy.get("script-src")).toContain("https://platform.twitter.com");
  });

  test("lets storage be read and uploaded to", async () => {
    const policy = await reportOnly();
    const storage = [
      "https://abc.supabase.co",
      "https://prod.public.blob.vercel-storage.com",
      "https://dev.public.blob.vercel-storage.com",
    ];
    expect(policy.get("connect-src")).toEqual(
      expect.arrayContaining([...storage, "https://vercel.com/api/blob/"]),
    );
    expect(policy.get("media-src")).toEqual(expect.arrayContaining(storage));
  });

  test("lets documents show images from any secure link", async () => {
    expect((await reportOnly()).get("img-src")).toEqual(
      expect.arrayContaining(["https:", "data:", "blob:"]),
    );
  });

  test("lets BYOK text reach OpenRouter from the browser", async () => {
    expect((await reportOnly()).get("connect-src")).toContain(
      "https://openrouter.ai",
    );
  });

  test("lets Google font files load behind the proxied stylesheet", async () => {
    expect((await reportOnly()).get("font-src")).toContain(
      "https://fonts.gstatic.com",
    );
  });

  test("lets Excalidraw register its font fallback, and nothing else of esm.sh", async () => {
    const fonts = (await reportOnly()).get("font-src") ?? [];
    expect(fonts).toContain("https://esm.sh/@excalidraw/");
    expect(fonts).not.toContain("https://esm.sh");
  });

  test("loads React Scan only when it is enabled", async () => {
    expect((await reportOnly()).get("script-src")).not.toContain(
      "https://unpkg.com",
    );
    env.REACT_SCAN_ENABLED = true;
    try {
      expect((await reportOnly()).get("script-src")).toContain(
        "https://unpkg.com",
      );
    } finally {
      env.REACT_SCAN_ENABLED = false;
    }
  });
});
