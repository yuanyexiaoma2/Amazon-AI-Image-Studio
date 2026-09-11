import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { normalizeEmail } from '@studio/domain';
import { prisma, UserRepository } from '@studio/db';
import { verifyPassword } from './password';
import {
  checkLoginRateLimit,
  clearLoginFailures,
  getClientIp,
  recordLoginFailure,
} from './login-rate-limit';

/** JWT lifetime: 24 hours (ADR-0002 / CR-0001). */
export const JWT_MAX_AGE_SECONDS = 60 * 60 * 24;

/** Thrown when login is rate-limited; route wrapper maps to HTTP 429. */
export class LoginRateLimitedError extends Error {
  constructor(message = 'Too many login attempts. Try again later.') {
    super(message);
    this.name = 'LoginRateLimitedError';
  }
}

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
      async authorize(credentials, request) {
        const email = normalizeEmail(String(credentials?.email ?? ''));
        const password = String(credentials?.password ?? '');
        const ip = request ? getClientIp(request) : 'unknown';

        if (!email || !password) return null;

        const limited = await checkLoginRateLimit(ip, email);
        if (limited.limited) {
          throw new LoginRateLimitedError();
        }

        const users = new UserRepository(prisma);
        const user = await users.findByEmail(email);
        // Same path for unknown email / bad password / inactive — no registration leak.
        if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
          await recordLoginFailure(ip, email);
          return null;
        }

        const ok = await verifyPassword(user.passwordHash, password);
        if (!ok) {
          await recordLoginFailure(ip, email);
          return null;
        }

        await clearLoginFailures(ip, email);

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
