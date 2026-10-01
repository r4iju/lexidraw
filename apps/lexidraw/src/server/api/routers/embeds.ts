import { TRPCError } from "@trpc/server";
import { z } from "zod";
import env from "@packages/env";
import {
  embedRenderImage,
  embedRenderRequest,
  type EmbedRequest,
} from "~/lib/embed-render-contract";
import { sanitizeArticleContent } from "~/server/extractors/article";
import { createSVGPreview } from "~/server/documents/svg-preview";
import { createEmbedRenderer } from "~/server/documents/embedded-render";
import { askRenderWorker } from "~/server/render-worker";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const render = createEmbedRenderer(async (request) => {
  const base =
    env.HEADLESS_RENDER_URL?.replace(/\/+$/, "") ??
    (env.NODE_ENV !== "production" ? "http://localhost:4025" : undefined);
  if (!base || env.HEADLESS_RENDER_ENABLED === false)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Embedded rendering is not configured",
    });
  const origin = new URL(
    env.NEXTAUTH_URL.includes("://")
      ? env.NEXTAUTH_URL
      : `https://${env.NEXTAUTH_URL}`,
  ).origin;
  const response = await askRenderWorker(
    `${base}/api/render/embed`,
    { url: `${origin}/native-render`, request },
    { signal: AbortSignal.timeout(55000) },
  );
  if (!response.ok)
    throw new TRPCError({
      code: response.status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
      message: await response.text(),
    });
  return embedRenderImage.parse(await response.json());
});

const svgPreview = createSVGPreview(async (source) => {
  const base =
    env.HEADLESS_RENDER_URL?.replace(/\/+$/, "") ??
    (env.NODE_ENV !== "production" ? "http://localhost:4025" : undefined);
  if (!base || env.HEADLESS_RENDER_ENABLED === false)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "SVG rendering is not configured",
    });
  const response = await askRenderWorker(
    `${base}/api/render/svg`,
    { source: Buffer.from(source).toString("base64") },
    { signal: AbortSignal.timeout(55000) },
  );
  if (!response.ok)
    throw new TRPCError({
      code: response.status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
      message: await response.text(),
    });
  return z
    .object({
      png: z.string().max(12000000),
      width: z.number().positive().max(16384),
      height: z.number().positive().max(16384),
      rasterWidth: z.number().int().positive().max(2048),
      rasterHeight: z.number().int().positive().max(2048),
    })
    .parse(await response.json());
});

export const embedRouter = createTRPCRouter({
  rasterizeSVG: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/embeds/rasterize-svg",
        protect: true,
        tags: ["embeds"],
        summary: "Preview original SVG media as a bounded PNG",
        description:
          "Rasterizes inert SVG image content without running scripts or fetching external resources. The original media stays unchanged; PNG is only the native preview. Original intrinsic dimensions are returned separately from downsampled pixels.",
      },
    })
    .input(z.object({ source: z.string().min(1).max(10666668) }))
    .output(
      z.object({
        hash: z.string(),
        png: z.string().max(12000000),
        width: z.number().positive().max(16384),
        height: z.number().positive().max(16384),
      }),
    )
    .mutation(async ({ input }) => {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.source))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid SVG data",
        });
      const data = Buffer.from(input.source, "base64");
      if (data.byteLength > 8_000_000)
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: "SVG source exceeds the image limit",
        });
      return svgPreview(data);
    }),
  render: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/embeds/render",
        protect: true,
        tags: ["embeds"],
        summary: "Render a node as themed SVG with a PNG preview",
        description:
          "SVG contains styled XHTML in foreignObject and requires a browser-compatible SVG renderer and the page's fonts. PNG is the same rendered page at 2x scale, for clients without that renderer. Cached by payload, theme, size, font and deployment revision.",
      },
    })
    .input(
      z.object({
        node: z.string().max(262144),
        theme: z.enum(["light", "dark"]),
        width: z.number().int().min(1).max(2048),
        fontFamily: z.string().min(1).max(120),
        fontSize: z.number().min(1).max(256),
        includeAccessibility: z.boolean().optional(),
      }),
    )
    .output(embedRenderImage.extend({ hash: z.string() }))
    .mutation(async ({ input }) => {
      let request: EmbedRequest;
      try {
        request = embedRenderRequest.parse({
          ...input,
          node: JSON.parse(input.node),
        });
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid embedded node payload",
        });
      }
      if (request.node.type === "article") {
        const data = request.node.data;
        const snapshot = data.mode === "url" ? data.distilled : data.snapshot;
        if (snapshot) {
          snapshot.contentHtml = sanitizeArticleContent(
            snapshot.contentHtml,
            data.mode === "url" ? data.url : env.NEXTAUTH_URL,
            true,
          );
        }
      }
      return render(request);
    }),
});
