import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
// import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { AdapterUser } from '@auth/core/adapters';
import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { db } from '~/server/db';
import { SignInSchema } from '~/app/auth/signin/schema';

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
  adapter: PrismaAdapter(db),
  pages: {
    signIn: '/auth/signin',
    newUser: '/auth/signup',
    error: '/auth/error',
  },
  callbacks: {
    session: (params) => {
      const id: string | undefined = (() => {
        if ('user' in params) {
          return params.user.id;
        } else if ('token' in params) {
          return params.token.sub;
        }
      })();
      if (!id) throw new Error('No user id');
      return {
        ...params.session,
        user: {
          ...params.session.user,
          id,
        },
      };
    },
    jwt: ({ token }) => {
      return token;
    },
    signIn: ({ user }) => {
      const isEmailVerified = z
        .date()
        .nullable()
        .refine((val) => val !== null, { message: 'Email is not verified' })
        .parse((user as AdapterUser).emailVerified);
      if (!isEmailVerified) {
        return false;
      }
      return true;
    },
    redirect: ({ baseUrl }) => {
      return `${baseUrl}/dashboard`;
    },
  },
  providers: [
    // GoogleProvider({
    //   clientId: env.GOOGLE_CLIENT_ID,
    //   clientSecret: env.GOOGLE_CLIENT_SECRET,
    //   authorization: {
    //     params: {
    //       scope:
    //         'openid email profile',
    //       access_type: 'offline',
    //       prompt: 'consent',
    //       response_type: 'code',
    //     },
    //   },
    // }),
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
