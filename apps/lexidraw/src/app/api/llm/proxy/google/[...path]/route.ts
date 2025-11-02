import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import env from "@packages/env";

async function handle(req: NextRequest, pathSegsParam?: string[]) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const apiKey = env.GOOGLE_API_KEY;
  if (!apiKey) {
    return new Response("Server missing GOOGLE_API_KEY", { status: 500 });
  }

  const pathSegs = Array.isArray(pathSegsParam) ? pathSegsParam : [];
  const upstreamPath = pathSegs.join("/");
  const upstreamPathWithVersion = upstreamPath.startsWith("v")
    ? upstreamPath
    : `v1beta/${upstreamPath}`;
  const url = new URL(req.url);

  // Google Generative AI base URL; the SDK usually hits /v1beta/*
  const upstreamUrl = new URL(
    `https://generativelanguage.googleapis.com/${upstreamPathWithVersion}`,
  );
  // Preserve incoming query, but enforce server key
  upstreamUrl.search = url.search;
  upstreamUrl.searchParams.set("key", apiKey);

  const incomingHeaders = new Headers(req.headers);
  const outboundHeaders = new Headers();
  const ct = incomingHeaders.get("content-type");
  if (ct) outboundHeaders.set("content-type", ct);

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
