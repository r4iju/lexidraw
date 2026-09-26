import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Nil when `request` carries the secret this worker shares with the app,
 * and otherwise the 401 to answer with; while the worker has no secret,
 * nobody's request is taken.
 */
export function refusedUnlessFromTheApp(
  request: Request,
  secret = process.env.RENDER_WORKER_SECRET,
): NextResponse | undefined {
  const sent = /^Bearer (.+)$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  // Digests are all one length, so comparing them takes the same time
  // however much of the secret was guessed.
  if (secret && sent && timingSafeEqual(digest(sent), digest(secret)))
    return undefined;
  return new NextResponse("Unauthorized", { status: 401 });
}

const digest = (text: string) => createHash("sha256").update(text).digest();
