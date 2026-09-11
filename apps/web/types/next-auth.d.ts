import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
    };
    /** JWT-embedded sessionVersion for revocation checks (ADR-0002). */
    sessionVersion?: number;
  }

  interface User {
    sessionVersion?: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sessionVersion?: number;
  }
}
