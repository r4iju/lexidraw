import { createMcpHandler } from "mcp-handler";

import { apiErrorBody } from "~/server/api/error-body";
import { API_ERROR_STATUS } from "~/server/api/error-codes";
import { appRouter } from "~/server/api/root";
import { createRestContext } from "~/server/api/trpc";
import { MCP_INSTRUCTIONS, registerLexidrawTools } from "~/server/mcp/tools";

const SERVER_INFO = { name: "lexidraw", version: "1.0.0" };

/**
 * A stateless streamable HTTP MCP endpoint, authenticated with the same
 * personal access tokens as `/api/v1`. Nothing is remembered between requests:
 * the token is resolved, a server is built around a tRPC caller holding that
 * caller's context, and both are dropped when the response is written.
 *
 * POST only. A GET would open the stream a subscription needs, and there is
 * nothing here to subscribe to, so Next answers the other methods with a 405
 * before any of this runs.
 */
async function handler(req: Request): Promise<Response> {
  let ctx: Awaited<ReturnType<typeof createRestContext>>;
  try {
    ctx = await createRestContext({ headers: new Headers(req.headers) });
  } catch (error) {
    // The transport answers a bad token itself: a JSON-RPC error would make a
    // revoked token look like a working connection whose every tool fails.
    const body = apiErrorBody(error);
    if (body.code === "INTERNAL_SERVER_ERROR") {
      console.error("❌ MCP context failed:", error);
    }
    return Response.json(body, { status: API_ERROR_STATUS[body.code] });
  }
  const caller = appRouter.createCaller(ctx);
  const serve = createMcpHandler(
    (server) => registerLexidrawTools(server, caller),
    {
      serverInfo: SERVER_INFO,
      instructions: MCP_INSTRUCTIONS,
      // No SSE: a subscription is refused outright rather than answered with
      // a stream this endpoint would never write to.
      maxSubscriptions: 0,
      // A transport failure never reaches a procedure, so `onError` on the
      // caller cannot see it and this is the only place it survives.
      onEvent: (event) => {
        if (event.type === "ERROR") {
          console.error("❌ MCP transport failed:", event.error);
        }
      },
    },
  );
  return serve(req);
}

export { handler as POST };
