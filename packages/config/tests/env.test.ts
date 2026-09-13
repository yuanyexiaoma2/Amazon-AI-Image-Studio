import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

describe('loadEnv', () => {
  it('accepts development defaults with DATABASE_URL', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://studio:studio@localhost:5432/studio',
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.IMAGE_PROVIDER).toBe('fake');
  });

  it('fails fast in production without AUTH_SECRET', () => {
    expect(() =>
      loadEnv(
        {
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://x:y@localhost:5432/studio',
        },
        { production: true },
      ),
    ).toThrow(/AUTH_SECRET/);
  });

  it('fails when DATABASE_URL is invalid empty in production', () => {
    expect(() =>
      loadEnv(
        {
          NODE_ENV: 'production',
          DATABASE_URL: '',
          AUTH_SECRET: 'a'.repeat(32),
        },
        { production: true },
      ),
    ).toThrow(/Invalid environment/);
  });
});

  it('accepts IMAGE_PROVIDER=kie for P2-A', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://studio:studio@localhost:5432/studio',
      IMAGE_PROVIDER: 'kie',
      KIE_BASE_URL: 'https://api.kie.ai',
    });
    expect(env.IMAGE_PROVIDER).toBe('kie');
  });

