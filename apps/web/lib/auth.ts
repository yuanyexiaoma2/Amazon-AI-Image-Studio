import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma, UserRepository } from '@studio/db';
import { verifyPassword } from './password';

/**
 * Auth.js Credentials + Prisma models.
 * Note: Auth.js does not support database session strategy with the Credentials
 * provider (sessions would never be created). We use JWT sessions for email/password
 * MVP while keeping Session/Account tables in Prisma for future OAuth and revocation hooks.
 * See docs/progress.md W1-05 evidence.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma) as never,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? '')
          .toLowerCase()
          .trim();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;

        const users = new UserRepository(prisma);
        const user = await users.findByEmail(email);
        if (!user || user.status !== 'ACTIVE' || user.deletedAt) return null;

        const ok = await verifyPassword(user.passwordHash, password);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  trustHost: true,
});
