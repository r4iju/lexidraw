import type { Context } from "./context";
import { CliError } from "./errors";
import { API_PREFIX } from "./http";
import { loadDocument } from "./openapi";
import { requireToken } from "./tokens";

/** What `/api/v1/openapi.json` calls itself, set in the app's `openapi.ts`. */
export const API_TITLE = "Lexidraw API";

declare const opened: unique symbol;

/**
 * Where a command sends its calls, with the token resolved once. A token is a
 * credential, and a mistyped or outdated base URL must not be enough to hand
 * it to whoever answers there, so `requestApi` awaits `verify` — the host
 * serving Lexidraw's own OpenAPI document, itself, without a redirect —
 * before the first request that carries it.
 */
export type ApiSession = {
  readonly baseUrl: string;
  readonly token: string;
  readonly verify: () => Promise<void>;
  readonly [opened]: true;
};

/** A session for `token`, or for the one the profile resolves to. */
export function openSession(context: Context, token?: string): ApiSession {
  const resolved =
    token ??
    requireToken(context.profile, context.io.env, context.io.tokens).token;
  let verified: Promise<void> | undefined;
  return {
    baseUrl: context.profile.baseUrl,
    token: resolved,
    verify: () => {
      verified ??= verifyServer(context);
      return verified;
    },
  } as ApiSession;
}

async function verifyServer(context: Context): Promise<void> {
  const { profile, io, refresh } = context;
  let title: string | undefined;
  try {
    const { document } = await loadDocument({ profile, refresh, env: io.env });
    title = document.info?.title;
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    if (error.code === "REDIRECT") {
      const target = redirectBase(context, error.details.location);
      throw notLexidraw(
        context,
        `redirects to ${error.details.location}`,
        target
          ? `Point LEXIDRAW_URL at ${target}.`
          : "Point LEXIDRAW_URL at the server itself.",
      );
    }
    // Lexidraw serves the document at that path, as JSON, to anyone; a 5xx
    // is an outage worth reporting as one.
    const status = Number(error.details.status);
    const absent =
      error.code === "NOT_FOUND" ||
      (error.code === "BAD_RESPONSE" && status < 500);
    if (!absent) throw error;
  }
  if (title !== API_TITLE) {
    throw notLexidraw(
      context,
      "does not serve the Lexidraw API",
      "Check LEXIDRAW_URL or --profile.",
    );
  }
}

function notLexidraw(context: Context, why: string, hint: string): CliError {
  const { profile } = context;
  return new CliError(
    "NOT_LEXIDRAW_SERVER",
    `${profile.origin} ${why}; no token was sent. ${hint}`,
    { details: { profile: profile.name, baseUrl: profile.baseUrl } },
  );
}

const OPENAPI_PATH = `${API_PREFIX}/openapi.json`;

/** The base URL a redirect of the OpenAPI document points at, when it points
 * at another document path rather than a login page or the like. */
function redirectBase(context: Context, location: unknown): string | null {
  if (typeof location !== "string") return null;
  const from = `${context.profile.baseUrl}${OPENAPI_PATH}`;
  const url = URL.parse(location, from);
  if (!url?.href.endsWith(OPENAPI_PATH) || url.search) return null;
  return url.href.slice(0, -OPENAPI_PATH.length);
}
