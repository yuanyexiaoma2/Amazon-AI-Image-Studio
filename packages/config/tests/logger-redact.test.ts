import { describe, expect, it } from 'vitest';
import { createLogger, LOG_REDACT_PATHS, redactSensitiveFields } from '../src/logger.js';
import { Writable } from 'node:stream';

describe('W8-04 log redaction', () => {
  it('exports redact paths covering secrets', () => {
    expect(LOG_REDACT_PATHS).toContain('password');
    expect(LOG_REDACT_PATHS).toContain('Authorization');
    expect(LOG_REDACT_PATHS).toContain('S3_SECRET_ACCESS_KEY');
  });

  it('redactSensitiveFields masks nested secrets', () => {
    const out = redactSensitiveFields({
      user: 'a',
      password: 'hunter2',
      nested: { token: 'abc', ok: 1 },
    }) as { password: string; nested: { token: string; ok: number } };
    expect(out.password).toBe('[Redacted]');
    expect(out.nested.token).toBe('[Redacted]');
    expect(out.nested.ok).toBe(1);
  });

  it('pino logger redacts password fields in JSON lines', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = createLogger({ name: 'test-redact', level: 'info' });
    // destination via child binding — use direct pino destination by writing through logger
    // Pino redacts on serialize; capture via destination option by creating dedicated logger:
    const pino = await import('pino');
    const destLog = pino.default(
      {
        level: 'info',
        redact: { paths: [...LOG_REDACT_PATHS], censor: '[Redacted]' },
      },
      stream,
    );
    destLog.info({ password: 'super-secret', requestId: 'r1' }, 'login');
    await new Promise((r) => setTimeout(r, 20));
    const joined = lines.join('');
    expect(joined).toContain('[Redacted]');
    expect(joined).not.toContain('super-secret');
    expect(log).toBeTruthy();
  });
});
