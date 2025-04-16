import NextAuth, { Session, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { drizzle } from "@packages/drizzle";
import { getSignInSchema } from "~/app/signin/schema";
import env from "@packages/env";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      config: {
        llm: { googleApiKey: string; openaiApiKey: string };
      };
    } & DefaultSession["user"];
  }
}

export const {
  handlers: { GET, POST },
  auth,
} = NextAuth({
  ...(process.env.TRUST_HOST ? { trustHost: true } : {}),
  // types dont match in current versions..
  adapter: DrizzleAdapter(drizzle as (typeof DrizzleAdapter)["arguments"]),
  pages: {
    signIn: "/signin",
    newUser: "/signup",
    signOut: "/signout",
    error: "/error",
  },
  callbacks: {
    session: (params) => {
      if (!("token" in params)) {
        throw new Error("token should not be passed to session callback");
      }
      const { session, token } = params;
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub,
          config: token.config || { llm: { googleApiKey: "" } },
        },
      };
    },
    jwt: async ({ token, user, trigger }) => {
      if (user) {
        token.config = (user as Session["user"]).config || {
          llm: { googleApiKey: "" },
        };
      }

      if (trigger === "update") {
        const dbUser = await drizzle.query.users.findFirst({
          where: (users, { eq }) => eq(users.email, token.email as string),
        });
        token.config = dbUser?.config || { llm: { googleApiKey: "" } };
      }

      return token;
    },
    signIn: () => {
      return true;
    },
    redirect: ({ baseUrl }) => {
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

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, ...user } = dbUser;
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
  // debug: true,
});
