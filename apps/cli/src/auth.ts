import { one, parseArgs, rejectExtra } from "./args";
import { json, type Context } from "./context";
import { usageError } from "./errors";
import { expectOk, requestApi } from "./http";
import { keychainRefusal } from "./profile";
import { requireToken } from "./tokens";

/** `lxd_` plus base64url, as the server mints them. */
const TOKEN_PATTERN = /^lxd_[A-Za-z0-9_-]+$/;

export type Me = {
  userId: string;
  email: string | null;
  authKind: "session" | "token";
  scope: "read" | "write" | null;
};

/** The cheapest call that proves a token is live and says what it may do. */
export async function fetchMe(baseUrl: string, token: string): Promise<Me> {
  const response = await requestApi({
    baseUrl,
    method: "GET",
    path: "/me",
    token,
  });
  return expectOk(response, "the server rejected this token") as Me;
}

export async function authLogin(
  context: Context,
  argv: readonly string[],
): Promise<void> {
  const args = parseArgs(argv, { value: ["token"], boolean: [] });
  rejectExtra(args, 0);

  if (!context.profile.keychainAllowed) {
    throw usageError(
      `cannot store a token for this origin: ${keychainRefusal(context.profile)}`,
    );
  }

  const token = (one(args, "token") ?? (await promptForToken(context))).trim();
  if (token === "") {
    throw usageError("no token given on --token or stdin");
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw usageError("a Lexidraw token is lxd_ followed by base64url");
  }

  // Validated before it is stored: a keychain entry that does not work is
  // worse than no entry at all.
  const me = await fetchMe(context.profile.baseUrl, token);
  context.io.tokens.set(context.profile.name, token);
  context.io.stdout(
    json({
      profile: context.profile.name,
      userId: me.userId,
      email: me.email,
      scope: me.scope,
    }),
  );
}

export async function authStatus(
  context: Context,
  argv: readonly string[],
): Promise<void> {
  const args = parseArgs(argv, { value: [], boolean: [] });
  rejectExtra(args, 0);

  const { name, baseUrl } = context.profile;
  const { token, source } = requireToken(
    context.profile,
    context.io.env,
    context.io.tokens,
  );
  const me = await fetchMe(baseUrl, token);
  context.io.stdout(
    json({
      profile: name,
      baseUrl,
      tokenSource: source,
      user: { userId: me.userId, email: me.email },
      scope: me.scope,
    }),
  );
}

async function promptForToken(context: Context): Promise<string> {
  if (!context.io.stdinIsTty) return context.io.readLine();
  context.io.stderr(`Paste a token for profile "${context.profile.name}": `);
  // A pasted token would otherwise stay on screen and in the scrollback.
  context.io.setEcho(false);
  try {
    return await context.io.readLine();
  } finally {
    context.io.setEcho(true);
    context.io.stderr("\n");
  }
}
