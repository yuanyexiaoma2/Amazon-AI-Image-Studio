import pino, { type Logger } from 'pino';

export type CreateLoggerOptions = {
  name?: string;
  level?: string;
  requestId?: string;
};

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return pino({
    name: options.name ?? 'studio',
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    base: {
      service: options.name ?? 'studio',
      ...(options.requestId ? { requestId: options.requestId } : {}),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export function childLogger(parent: Logger, bindings: Record<string, unknown>): Logger {
  return parent.child(bindings);
}
