export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { statSync } from "node:fs";
import path from "node:path";

export async function GET() {
  try {
    const filePath = path.resolve(process.cwd(), "public", "chromium-pack.tar");
    const stat = statSync(filePath);
    const stream = createReadStream(filePath);
    return new NextResponse(stream as any, {
      headers: {
        "content-type": "application/x-tar",
        "content-length": String(stat.size),
        "cache-control": "public, max-age=31536000, immutable, no-transform",
        "content-disposition": 'inline; filename="chromium-pack.tar"',
      },
    });
  } catch (e) {
    return new NextResponse("chromium pack not found", { status: 404 });
  }
}
