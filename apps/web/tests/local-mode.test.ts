/**
 * PR-6 — LOCAL_MODE two-tier access (unit): browsing/editing act as the local
 * principal without any Auth.js session; paid boundaries (requirePaidSession)
 * still demand a real session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
const principalMock = vi.fn();

vi.mock('../lib/auth', () => ({ auth: () => authMock() }));
vi.mock('../lib/local-principal', () => ({ ensureLocalPrincipal: () => principalMock() }));
vi.mock('@studio/db', () => ({
  prisma: {},
  UserRepository: class {},
}));

import { isLocalMode } from '../lib/local-mode';
import { requireActiveSession, requirePaidSession } from '../lib/session-guard';

const LOCAL_USER = {
  user: { id: 'u-local', email: 'local@studio.local', sessionVersion: 0 },
  workspace: { id: 'ws-local' },
  project: { id: 'p-local' },
};

afterEach(() => {
  delete process.env.LOCAL_MODE;
  authMock.mockReset();
  principalMock.mockReset();
});

describe('isLocalMode', () => {
  it('parses 1/true as on, everything else as off', () => {
    expect(isLocalMode()).toBe(false);
    process.env.LOCAL_MODE = '1';
    expect(isLocalMode()).toBe(true);
    process.env.LOCAL_MODE = 'true';
    expect(isLocalMode()).toBe(true);
    process.env.LOCAL_MODE = '0';
    expect(isLocalMode()).toBe(false);
    process.env.LOCAL_MODE = 'false';
    expect(isLocalMode()).toBe(false);
  });
});

describe('requireActiveSession in LOCAL_MODE', () => {
  it('returns the local principal without touching Auth.js', async () => {
    process.env.LOCAL_MODE = '1';
    principalMock.mockResolvedValue(LOCAL_USER);

    const session = await requireActiveSession();

    expect(session).toEqual({
      userId: 'u-local',
      email: 'local@studio.local',
      sessionVersion: 0,
    });
    expect(authMock).not.toHaveBeenCalled();
  });
});

describe('requirePaidSession (paid boundary)', () => {
  it('still throws UNAUTHENTICATED in LOCAL_MODE when no real session', async () => {
    process.env.LOCAL_MODE = '1';
    authMock.mockResolvedValue(null);

    await expect(requirePaidSession()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('throws UNAUTHENTICATED outside LOCAL_MODE when no session', async () => {
    authMock.mockResolvedValue(null);
    await expect(requireActiveSession()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
