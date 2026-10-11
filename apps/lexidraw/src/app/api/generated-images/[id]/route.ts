import { createTRPCContext } from "~/server/api/trpc";
import { readBearerApiToken } from "~/server/auth/api-token-format";
import { generatedImages } from "~/server/pro/image-runtime";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};
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
  try {
    const { id } = await context.params;
    const bytes = await generatedImages().read(account ?? "", id);
    if (!bytes) return new Response(null, { status: 404, headers });
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": "image/png",
        "Content-Length": String(bytes.length),
        "Content-Disposition": "inline; filename=generated-image.png",
      },
    });
  } catch {
    return new Response("Image temporarily unavailable", {
      status: 503,
      headers,
    });
  }
}
