import NextAuth, { type Session, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { drizzle, schema, eq } from "@packages/drizzle";
import { getSignInSchema } from "~/app/signin/schema";
import env from "@packages/env";
import { cookies as nextCookies } from "next/headers";

// Define the structure for LLM config based on schema
type LlmBaseConfig = {
  modelId: string;
  provider: string;
  temperature: number;
  maxOutputTokens: number;
};

type LlmConfig = {
  chat?: LlmBaseConfig;
  agent?: LlmBaseConfig;
  autocomplete?: LlmBaseConfig;
};

type TtsConfig = {
  provider?: "openai" | "google";
  voiceId?: string;
  speed?: number;
  format?: "mp3" | "ogg" | "wav";
  languageCode?: string;
  sampleRate?: number;
};

type ArticleConfig = {
  languageCode?: string;
  maxChars?: number;
  keepQuotes?: boolean;
  autoGenerateAudioOnImport?: boolean;
};

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      effectiveUserId?: string;
      isImpersonating?: boolean;
      impersonatorAdminId?: string;
      // Update the config type here
      config?: {
        autoSave?: { enabled?: boolean };
        llm?: Partial<LlmConfig>; // Use the defined LlmConfig type, make it partial
        audio?: { preferredPlaybackRate?: number };
        tts?: Partial<TtsConfig>;
        articles?: Partial<ArticleConfig>;
        autocomplete?: {
          enabled?: boolean;
          delayMs?: number;
          provider?: "openai";
          modelId?: string;
          temperature?: number;
          maxOutputTokens?: number;
          reasoningEffort?: "minimal" | "standard" | "heavy";
          verbosity?: "low" | "medium" | "high";
        };
      };
    } & DefaultSession["user"];
  }
  // If you are also augmenting the User type, update it here as well
  // interface User {
  //   config?: {
  //     llm?: Partial<LlmConfig>;
  //   };
  // }
}

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

const nextAuth = NextAuth({
  ...(shouldTrustHost ? { trustHost: true } : {}),
  cookies,
  adapter: DrizzleAdapter(drizzle as (typeof DrizzleAdapter)["arguments"]),
  pages: {
    ...(shouldTrustHost
      ? {
          signIn: "/signin",
          newUser: "/signup",
          signOut: "/signout",
          error: "/error",
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
    jwt: async ({ token, user, trigger, session }) => {
      // Add session to params if using update
      // Initial sign in or user object available
      if (user) {
        // Explicitly type user to access custom fields safely
        const typedUser = user as Session["user"];
        token.config = typedUser.config;
      }

      // Handle session updates (e.g., after profile update)
      if (trigger === "update" && session) {
        console.log("[Auth] JWT update trigger fired with session:", session);
        // Refetch the user from DB to get the latest config
        // Note: Ensure session data passed via update() call includes the necessary fields
        // or fetch fresh data here.
        const dbUser = await drizzle.query.users.findFirst({
          // Use token.sub (user id) for fetching, assuming email might not be unique or stable
          where: (users, { eq }) => eq(users.id, token.sub as string),
        });
        console.log("[Auth] Fetched user for JWT update:", dbUser);
        token.config = dbUser?.config; // Update token config from DB
        // Propagate other potential updates from session if needed
        token.name = session.user.name;
        token.email = session.user.email;
        token.picture = session.user.image;
      }

      return token;
    },
    signIn: () => {
      return true;
    },
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
  providers: [
    GitHubProvider({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      authorization: { params: { scope: "read:user user:email" } },
    }),
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
      authorize: async (credentials) => {
        const SignInSchema = getSignInSchema();
        const parsedCredentials = SignInSchema.parse(credentials);

        const dbUser = await drizzle.query.users.findFirst({
          where: (users, { eq }) => eq(users.email, parsedCredentials.email),
        });

        if (!dbUser?.password) return null;
        const encoder = new TextEncoder();
        const data = encoder.encode(parsedCredentials.password);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashedSubmittedPassword = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const isPasswordCorrect = hashedSubmittedPassword === dbUser.password;

        if (!isPasswordCorrect) return null;

        const { password: _password, ...user } = dbUser;
        return user;
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

export const {
  handlers: { GET, POST },
  auth,
} = nextAuth;

export const IMPERSONATE_COOKIE_NAME = "impersonate_user_id";

export async function authEffective(): Promise<Session | null> {
  const session = await auth();
  if (!session?.user?.id) return session;

  // Only allow impersonation if the real user is an admin
  const rows = await drizzle
    .select({ roleName: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, session.user.id));
  const isAdmin = rows.some((r) => r.roleName === "admin");
  if (!isAdmin) return session;

  const cookies = await nextCookies();
  const targetUserId = cookies.get(IMPERSONATE_COOKIE_NAME)?.value;
  if (!targetUserId || targetUserId === session.user.id) return session;

  return {
    ...session,
    user: {
      ...session.user,
      effectiveUserId: targetUserId,
      isImpersonating: true,
      impersonatorAdminId: session.user.id,
    },
  } as Session;
}
