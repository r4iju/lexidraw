import type { Session, DefaultSession } from "next-auth";
import { drizzle, schema, eq } from "@packages/drizzle";
import { appleCredentials } from "~/server/auth/apple";
import { createAuth } from "~/server/auth/create-auth";
import {
  SIGN_IN_PROVIDERS,
  type SignInProvider,
} from "~/lib/sign-in-providers";
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

const apple = appleCredentials(env);

export const offeredProviders: readonly SignInProvider[] =
  SIGN_IN_PROVIDERS.filter((provider) => provider !== "apple" || apple);

const nextAuth = createAuth({
  db: drizzle,
  github: {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  },
  apple,
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
