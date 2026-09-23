import { one, parseArgs, rejectExtra } from "./args";
import { json, type Context } from "./context";
import { usageError } from "./errors";
import { expectOk, requestApi } from "./http";
import { requireToken } from "./tokens";

const TOKEN_PREFIX = "lxd_";

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

  const token = (one(args, "token") ?? (await promptForToken(context))).trim();
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw usageError(`a Lexidraw token starts with ${TOKEN_PREFIX}`);
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
    name,
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
  if (context.io.stdinIsTty) {
    context.io.stderr(`Paste a token for profile "${context.profile.name}": `);
  }
  const token = await context.io.readLine();
  if (token.trim() === "") {
    throw usageError("no token given on --token or stdin");
  }
  return token;
}
