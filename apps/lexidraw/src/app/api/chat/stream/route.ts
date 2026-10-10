import { eq } from "drizzle-orm";
import * as schema from "@packages/drizzle/drizzle-schema";
import { createTRPCContext } from "~/server/api/trpc";
import { readBearerApiToken } from "~/server/auth/api-token-format";
import { createChatStreamRoute } from "~/server/pro/chat-route";
import { proChat } from "~/server/pro/chat-runtime";
export const dynamic = "force-dynamic";
export const POST = createChatStreamRoute({
  chat: proChat,
  authorize: async (request) => {
    if (
      request.headers.has("Authorization") &&
      !readBearerApiToken(request.headers)
    )
      return null;
    try {
      const ctx = await createTRPCContext({ headers: request.headers });
      if (!ctx.session) return null;
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
