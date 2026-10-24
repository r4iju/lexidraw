import { createTRPCContext } from "~/server/api/trpc";
import { readBearerApiToken } from "~/server/auth/api-token-format";
import { proLedger } from "~/server/pro/runtime";
const headers = {
  "Cache-Control": "private, max-age=3600",
  Vary: "Cookie, Authorization",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Accept-Ranges": "bytes",
};
/** One account-owned narration part as WAV. Safari plays media only from servers that honour Range. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let account: string | undefined;
  try {
    if (
      request.headers.has("authorization") &&
      !readBearerApiToken(request.headers)
    )
      return new Response(null, { status: 401, headers });
    const ctx = await createTRPCContext({ headers: request.headers });
    account = ctx.session?.user.id;
  } catch {
    return new Response(null, { status: 401, headers });
  }
  if (!account) return new Response(null, { status: 401, headers });
  let bytes: Buffer;
  try {
    const { id } = await context.params;
    bytes = Buffer.from(
      (await proLedger().narrationPart(account, id)).audio,
      "base64",
    );
  } catch {
    return new Response(null, { status: 404, headers });
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1]
      ? Number(range[1])
      : Math.max(0, bytes.length - Number(range[2]));
    const end =
      range[1] && range[2]
        ? Math.min(Number(range[2]), bytes.length - 1)
        : bytes.length - 1;
    if (start > end || start >= bytes.length)
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${bytes.length}` },
      });
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: {
        ...headers,
        "Content-Type": "audio/wav",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
      },
    });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...headers,
      "Content-Type": "audio/wav",
      "Content-Length": String(bytes.length),
    },
  });
}
