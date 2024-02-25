import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
// import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter';
import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '@packages/db';
import { SignInSchema } from '~/app/auth/signin/schema';
import env from '@packages/env';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

export const {
  handlers: { GET, POST },
  auth,
} = NextAuth({
  // @ts-expect-error - something weird with the types here
  adapter: PrismaAdapter(db),
  pages: {
    signIn: '/auth/signin',
    newUser: '/auth/signup',
    signOut: '/auth/signout',
    error: '/auth/error',
  },
  callbacks: {
    session: async (params) => {
      const id: string | undefined = (() => {
        if ('user' in params) {
          return params.user.id;
        } else if ('token' in params) {
          return params.token.sub;
        }
      })();
      if (!id) throw new Error('No user id');
      const user = await db.user.findFirstOrThrow({
        where: { id },
        select: { id: true, email: true, name: true },
      })
      return {
        ...params.session,
        user,
      };
    },
    jwt: ({ token }) => {
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
      authorization: {
        params: { scope: "read:user user:email" },
      }
    }),
    Credentials({
      credentials: {
        name: { label: 'Name', type: 'text' },
        email: {
          label: 'Email',
          type: 'text',
          placeholder: 'someone@example.com',
        },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        const parsedCredentials = SignInSchema.parse(credentials);

        const dbUser = await db.user.findUnique({
          where: {
            email: parsedCredentials.email,
          },
        });

        if (!dbUser?.password) return null;
        const isPasswordCorrect = await bcrypt.compare(
          parsedCredentials.password,
          dbUser.password
        );
        if (!isPasswordCorrect) return null;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, ...user } = dbUser;
        return user;
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // 1 day
    generateSessionToken: () => {
      return randomBytes(32).toString('hex');
    },
  },
});
