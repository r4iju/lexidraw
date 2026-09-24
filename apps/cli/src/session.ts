import type { Context } from "./context";
import { CliError } from "./errors";
import { loadDocument } from "./openapi";
import { requireToken } from "./tokens";

/** What `/api/v1/openapi.json` calls itself, set in the app's `openapi.ts`. */
export const API_TITLE = "Lexidraw API";

declare const verified: unique symbol;

/**
 * Where a command sends its calls, with the token resolved once. Only
 * `openSession` makes one, and only once the host has served Lexidraw's own
 * OpenAPI document: a token is a credential, and a mistyped or outdated base
 * URL must not be enough to hand it to whoever answers there.
 */
export type ApiSession = {
  readonly baseUrl: string;
  readonly token: string;
  readonly [verified]: true;
};

/** A session for `token`, or for the one the profile resolves to. */
export async function openSession(
  context: Context,
  token?: string,
): Promise<ApiSession> {
  const resolved =
    token ??
    requireToken(context.profile, context.io.env, context.io.tokens).token;
  await verifyServer(context);
  return { baseUrl: context.profile.baseUrl, token: resolved } as ApiSession;
}

async function verifyServer(context: Context): Promise<void> {
  const { profile, io, refresh } = context;
  let title: string | undefined;
  try {
    const { document } = await loadDocument({ profile, refresh, env: io.env });
    title = document.info?.title;
  } catch (error) {
    // Lexidraw serves the document at that path, as JSON, to anyone.
    const absent =
      error instanceof CliError &&
      (error.code === "BAD_RESPONSE" || error.code === "NOT_FOUND");
    if (!absent) throw error;
  }
  if (title !== API_TITLE) {
    throw new CliError(
      "NOT_LEXIDRAW_SERVER",
      `${profile.origin} does not serve the Lexidraw API, so no token was sent to it; check LEXIDRAW_URL or --profile`,
      { details: { profile: profile.name, baseUrl: profile.baseUrl } },
    );
  }
}
