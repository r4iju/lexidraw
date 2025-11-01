import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import env from "@packages/env";

async function handle(req: NextRequest, pathSegsParam?: string[]) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response("Server missing OPENAI_API_KEY", { status: 500 });
  }

  const pathSegs = Array.isArray(pathSegsParam) ? pathSegsParam : [];
  const upstreamPath = pathSegs.join("/");
  const url = new URL(req.url);
  const upstreamUrl = new URL(`https://api.openai.com/v1/${upstreamPath}`);
  upstreamUrl.search = url.search; // preserve query

  const incomingHeaders = new Headers(req.headers);
  // Build outbound headers
  const outboundHeaders = new Headers();
  // Pass content-type if present
  const ct = incomingHeaders.get("content-type");
  if (ct) outboundHeaders.set("content-type", ct);
  // Authorization from server key
  outboundHeaders.set("authorization", `Bearer ${apiKey}`);
  // Allow provider to return streaming/event headers as-is

  const init: RequestInit = {
    method: req.method,
    headers: outboundHeaders,
    redirect: "follow",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const arr = await req.arrayBuffer();
    if (arr && arr.byteLength > 0) {
      init.body = arr as unknown as BodyInit;
    }
  }

  const upstream = await fetch(upstreamUrl.toString(), init);
  const ctResp = upstream.headers.get("content-type") || "";
  if (ctResp.includes("application/json")) {
    const json = await upstream.json().catch(async () => {
      const text = await upstream.text().catch(() => "");
      return { _raw: text };
    });
    return Response.json(json, { status: upstream.status });
  }
  const buf = await upstream.arrayBuffer();
  return new Response(buf, {
    status: upstream.status,
    headers: new Headers({
      "content-type": ctResp || "application/octet-stream",
    }),
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await ctx.params;
  return handle(req, path);
}
