import NextAuth, { type NextAuthConfig } from "next-auth";
import { NextRequest } from "next/server";
import { z } from "zod";
import Credentials from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq, schema, type drizzle } from "@packages/drizzle";
import { getSignInSchema } from "~/app/signin/schema";
import { authorizeCredentials } from "~/server/auth/credentials";
import { clientIp } from "~/server/auth/sign-in-rate-limit";
import { sessionToken } from "~/server/auth/session-token";
import env from "@packages/env";
import { type AppleCredentials, appleProvider } from "./apple";
import { isApplePostFromItsSite, repostFromThisSite } from "./form-post-relay";
import { admitOAuthSignIn, providerProvedEmail } from "./oauth-sign-in";

type Db = typeof drizzle;

/** Auth.js answers the session endpoint with null when nobody is signed in. */
const Session = z
  .object({ user: z.object({ id: z.string() }) })
  .nullable()
  .catch(null);
type AdapterTables = NonNullable<Parameters<typeof DrizzleAdapter<Db>>[1]>;

export type AuthDeps = {
  db: Db;
  github: { clientId: string; clientSecret: string };
  apple: AppleCredentials | null;
};

const isDev = process.env.NODE_ENV !== "production";
// should only flip to true never force false
const shouldTrustHost = isDev || Boolean(env.TRUST_HOST);
const cookies = isDev
  ? {
      sessionToken: {
        name: "authjs.session-token",
        options: {
          httpOnly: true,
          sameSite: "lax" as const,
          path: "/",
          secure: false,
        },
      },
      callbackUrl: {
        name: "authjs.callback-url",
        options: {
          sameSite: "lax" as const,
          path: "/",
          secure: false,
        },
      },
      csrfToken: {
        name: "authjs.csrf-token",
        options: {
          httpOnly: true,
          sameSite: "lax" as const,
          path: "/",
          secure: false,
        },
      },
    }
  : undefined;

/** Auth.js as Lexidraw configures it, over the given database and providers. */
export function createAuth({ db, github, apple }: AuthDeps) {
  // Sessions are JWTs, so only users and accounts are ever read or written.
  const adapter = DrizzleAdapter(db, {
    // `emailVerified` holds epoch ms where the adapter expects a Date. The
    // adapter only ever writes null to it, and nothing reads it back from it.
    usersTable: schema.users as unknown as AdapterTables["usersTable"],
    accountsTable: schema.accounts,
  });

  /** Who is signed in on the request, as Auth.js itself reads the session. */
  const signedInUserId = async (request: NextRequest | undefined) => {
    if (!request) return null;
    const response = await instance.handlers.GET(
      new NextRequest(new URL("/api/auth/session", request.url), {
        headers: request.headers,
      }),
    );
    const session = Session.parse(await response.json().catch(() => null));
    return session?.user.id ?? null;
  };

  const config = async (
    request: NextRequest | undefined,
  ): Promise<NextAuthConfig> => ({
    ...(shouldTrustHost ? { trustHost: true } : {}),
    cookies,
    adapter,
    pages: {
      ...(shouldTrustHost
        ? {
            signIn: "/signin",
            signOut: "/signout",
            error: "/signin-error",
          }
        : {}),
    },
    callbacks: {
      session: ({ session, token }) => {
        return {
          ...session,
          user: {
            ...session.user,
            id: token.sub,
            config: (token as unknown as { config?: unknown }).config,
          },
        };
      },
      jwt: (params) => sessionToken(db, params),
      signIn: (params) =>
        admitOAuthSignIn(db, params, () => signedInUserId(request)),
      redirect: ({ url, baseUrl }) => {
        try {
          // Allow relative callback URLs
          if (url.startsWith("/")) return `${baseUrl}${url}`;
          // Allow same-origin absolute URLs
          const dest = new URL(url);
          const base = new URL(baseUrl);
          if (dest.origin === base.origin) return url;
        } catch {
          // fall through to default
        }
        // Fallback: send to dashboard
        return `${baseUrl}/dashboard`;
      },
    },
    events: {
      signIn: async ({ user, account, profile, isNewUser }) => {
        if (!isNewUser || !user.id || !account || !profile) return;
        if (!providerProvedEmail(account.provider, profile)) return;
        await db
          .update(schema.users)
          .set({ emailVerified: Date.now() })
          .where(eq(schema.users.id, user.id));
      },
    },
    providers: [
      // Which emails link is decided by `admitOAuthSignIn`, for every provider.
      {
        ...GitHubProvider({
          clientId: github.clientId,
          clientSecret: github.clientSecret,
          authorization: { params: { scope: "read:user user:email" } },
        }),
        allowDangerousEmailAccountLinking: true,
      },
      ...(apple
        ? [
            {
              ...(await appleProvider(apple)),
              allowDangerousEmailAccountLinking: true,
            },
          ]
        : []),
      Credentials({
        credentials: {
          name: { label: "Name", type: "text" },
          email: {
            label: "Email",
            type: "text",
            placeholder: "someone@example.com",
          },
          password: { label: "Password", type: "password" },
        },
        authorize: async (credentials, request) => {
          const SignInSchema = getSignInSchema();
          const { email, password } = SignInSchema.parse(credentials);
          return authorizeCredentials(
            email,
            password,
            clientIp(request.headers),
          );
        },
      }),
    ],
    session: {
      strategy: "jwt",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      updateAge: 24 * 60 * 60, // 1 day
      generateSessionToken: () => {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      },
    },
  });

  const instance = NextAuth(config);
  return {
    ...instance,
    handlers: {
      GET: instance.handlers.GET,
      POST: (request: NextRequest) =>
        isApplePostFromItsSite(request)
          ? repostFromThisSite(request)
          : instance.handlers.POST(request),
    },
  };
}
