import { TRPCError } from "@trpc/server";
import { z } from "zod";
import env from "@packages/env";
import { embedRenderImage, embedRenderRequest } from "~/lib/embed-render-contract";
import { createEmbedRenderer } from "~/server/documents/embedded-render";
import { askRenderWorker } from "~/server/render-worker";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const render = createEmbedRenderer(async (request) => {
  const base = env.HEADLESS_RENDER_URL?.replace(/\/+$/, "") ?? (env.NODE_ENV !== "production" ? "http://localhost:4025" : undefined);
  if (!base || env.HEADLESS_RENDER_ENABLED === false) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Embedded rendering is not configured" });
  const origin = new URL(env.NEXTAUTH_URL.includes("://") ? env.NEXTAUTH_URL : `https://${env.NEXTAUTH_URL}`).origin;
  const response = await askRenderWorker(`${base}/api/render/embed`, { url: `${origin}/native-render`, request }, { signal: AbortSignal.timeout(55000) });
  if (!response.ok) throw new TRPCError({ code: response.status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST", message: await response.text() });
  return embedRenderImage.parse(await response.json());
});

export const embedRouter = createTRPCRouter({
  render: protectedProcedure.meta({ openapi: { method: "POST", path: "/embeds/render", protect: true, tags: ["embeds"], summary: "Render a node as themed SVG with a PNG preview", description: "SVG contains styled XHTML in foreignObject and requires a browser-compatible SVG renderer and the page's fonts. PNG is the same rendered page at 2x scale, for clients without that renderer. Cached by payload, theme, size, font and deployment revision." } })
    .input(z.object({ node: z.string().max(262144), theme: z.enum(["light", "dark"]), width: z.number().int().min(100).max(2048), fontFamily: z.string().min(1).max(120), fontSize: z.number().min(10).max(64) }))
    .output(embedRenderImage.extend({ hash: z.string() }))
    .mutation(async ({ input }) => {
      let request;
      try { request = embedRenderRequest.parse({ ...input, node: JSON.parse(input.node) }); }
      catch { throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid embedded node payload" }); }
      return render(request);
    }),
});
