import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import env from "@packages/env";
import { z } from "zod";

const ParamsSchema = z.object({
  id: z.string().min(1),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<z.infer<typeof ParamsSchema>> },
) {
  const resolvedParams = await params;
  const { id } = ParamsSchema.parse(resolvedParams);

  const manifestUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/tts/${id}/manifest.json`;
  const res = await fetch(manifestUrl);
  if (!res.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const json = await res.json();
  return NextResponse.json({ ...json, manifestUrl });
}
