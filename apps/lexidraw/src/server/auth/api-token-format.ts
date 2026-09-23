import { createHash, randomBytes } from "node:crypto";

export const API_TOKEN_PREFIX = "lxd_";

export type ApiTokenScope = "read" | "write";

export type RequestAuth =
  | { kind: "session" }
  | { kind: "token"; tokenId: string; scope: ApiTokenScope };

export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Returns the bearer token when the request carries one of ours, else null. */
export function readBearerApiToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const token = match?.[1];
  if (!token?.startsWith(API_TOKEN_PREFIX)) return null;
  return token;
}

/** Mutations need `write`; everything else is readable with any scope. */
export function tokenMayRun(
  auth: RequestAuth | undefined,
  type: "query" | "mutation" | "subscription",
): boolean {
  if (auth?.kind !== "token") return true;
  if (type !== "mutation") return true;
  return auth.scope === "write";
}
