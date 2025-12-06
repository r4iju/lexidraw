import type { TRPCErrorShape } from "@trpc/server/rpc";
import { TRPCError } from "@trpc/server";
import type { inferAsyncReturnType } from "@trpc/server";
import { verifySandboxToken } from "~/server/auth/sandbox-token";
import type { createTRPCContext } from "./trpc";

type Ctx = inferAsyncReturnType<typeof createTRPCContext>;

export function assertSandboxAuth(ctx: Ctx): void {
  const jwt =
    ctx.headers.get("x-sandbox-auth-jwt") ??
    ctx.headers.get("X-Sandbox-Auth-Jwt");
  if (!jwt) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing sandbox JWT" });
  }
  const verified = verifySandboxToken(jwt);
  if (!verified) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid sandbox JWT" });
  }
}

export function sandboxAuthMiddleware() {
  return async ({ ctx, next }: { ctx: Ctx; next: () => Promise<unknown> }) => {
    assertSandboxAuth(ctx);
    return next();
  };
}



