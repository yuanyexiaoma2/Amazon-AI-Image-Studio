import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma, UserRepository } from '@studio/db';
import { verifyPassword } from './password';

/** JWT lifetime: 24 hours (ADR-0002 / CR-0001). */
export const JWT_MAX_AGE_SECONDS = 60 * 60 * 24;

/**
 * Auth.js Credentials + JWT Session (not DB session).
 * Credentials provider cannot create DB sessions; we use JWT + User.sessionVersion
 * for revocation. See docs/adr/0002-auth-jwt-session.md.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma) as never,
  session: {
    strategy: 'jwt',
    maxAge: JWT_MAX_AGE_SECONDS,
  },
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
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sessionVersion = user.sessionVersion ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.sessionVersion =
          typeof token.sessionVersion === 'number' ? token.sessionVersion : 0;
      }
      return session;
    },
  },
  trustHost: true,
});
