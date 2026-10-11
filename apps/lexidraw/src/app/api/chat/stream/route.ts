import { eq } from "drizzle-orm";
import { after } from "next/server";
import * as schema from "@packages/drizzle/drizzle-schema";
import { createTRPCContext } from "~/server/api/trpc";
import {
  readBearerApiToken,
  tokenMayRun,
} from "~/server/auth/api-token-format";
import { createChatStreamRoute } from "~/server/pro/chat-route";
import { proChat } from "~/server/pro/chat-runtime";
export const dynamic = "force-dynamic";
// A detached run still has to reach provider completion and settlement, bounded by the pricebook's 30 second maximum.
export const maxDuration = 60;
export const POST = createChatStreamRoute({
  chat: proChat,
  retain: (work) => after(work),
  authorize: async (request) => {
    if (
      request.headers.has("Authorization") &&
      !readBearerApiToken(request.headers)
    )
      return null;
    try {
      const ctx = await createTRPCContext({ headers: request.headers });
      // This POST reserves and spends paid work, so it is a mutation for token scope.
      if (!ctx.session || !tokenMayRun(ctx.auth, "mutation")) return null;
      const [user] = await ctx.drizzle
        .select({ config: schema.users.config })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.session.user.id));
      return user?.config?.aiPower?.mode === "pro" ? ctx.session.user.id : null;
    } catch {
      return null;
    }
  },
});
