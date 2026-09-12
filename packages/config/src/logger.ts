import pino, { type Logger } from 'pino';

export type CreateLoggerOptions = {
  name?: string;
  level?: string;
  requestId?: string;
};

/** Paths redacted from structured logs (W8-04). */
export const LOG_REDACT_PATHS = [
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'AUTH_SECRET',
  'authSecret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'S3_SECRET_ACCESS_KEY',
  's3SecretAccessKey',
  'webhookSecret',
  'rawBody',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
] as const;

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return pino({
    name: options.name ?? 'studio',
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    base: {
      service: options.name ?? 'studio',
      ...(options.requestId ? { requestId: options.requestId } : {}),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...LOG_REDACT_PATHS],
      censor: '[Redacted]',
    },
  });
}

export function childLogger(parent: Logger, bindings: Record<string, unknown>): Logger {
  return parent.child(bindings);
}

/** Pure helper for unit tests — redact known secret keys in a shallow/deep object clone. */
export function redactSensitiveFields(input: unknown): unknown {
  const SENSITIVE = new Set(
    [
      'password',
      'currentpassword',
      'newpassword',
      'passwordhash',
      'authorization',
      'cookie',
      'auth_secret',
      'authsecret',
      'token',
      'accesstoken',
      'refreshtoken',
      'apikey',
      'secret',
      's3_secret_access_key',
      's3secretaccesskey',
      'webhooksecret',
      'rawbody',
    ].map((s) => s.toLowerCase()),
  );

  function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE.has(k.toLowerCase())) {
          out[k] = '[Redacted]';
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return value;
  }

  return walk(input);
}
