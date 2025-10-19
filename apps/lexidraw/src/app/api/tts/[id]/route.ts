import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import env from "@packages/env";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const manifestUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/tts/${id}/manifest.json`;
  const res = await fetch(manifestUrl);
  if (!res.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const json = await res.json();
  return NextResponse.json({ ...json, manifestUrl });
}
