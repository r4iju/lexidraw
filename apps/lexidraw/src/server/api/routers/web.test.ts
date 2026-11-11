/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const realExtractor = await import("~/server/extractors/article");
const { extractAndSanitizeArticle: realExtract } = realExtractor;
/** A site that is down, as a public address the network cannot reach. */
const DOWN = "https://down.example/post";
mock.module("~/server/extractors/article", () => ({
  ...realExtractor,
  extractAndSanitizeArticle: async ({ url }: { url: string }) => {
    if (url === DOWN) throw new Error("connect ECONNREFUSED 93.184.215.14:443");
    return realExtract({ url });
  },
}));
const { webRouter } = await import("./web");

const web = webRouter.createCaller({
  drizzle: db,
  schema,
  session: { user: { id: "web_user" } },
  auth: { kind: "session" },
  headers: new Headers(),
} as never);

describe("the agent's web page tool", () => {
  test("refuses a private address as the caller's mistake", async () => {
    await expect(
      web.extractWebpageContent({ url: "http://10.0.0.1/admin" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Not a public address: 10.0.0.1",
    });
  });

  test("reports a site it cannot reach as a failure, not the caller's mistake", async () => {
    const failed = await web
      .extractWebpageContent({ url: DOWN })
      .catch((error: { code: string }) => error);
    expect(failed).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
