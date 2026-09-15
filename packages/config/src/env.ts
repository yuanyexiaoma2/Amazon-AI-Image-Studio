import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AUTH_SECRET: z.string().min(16).optional(),
  AUTH_TRUST_HOST: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_BUCKET: z.string().default('studio-assets'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0')
    .default('true'),
  IMAGE_PROVIDER: z.enum(['fake', 'kie', 'openai', 'google']).default('fake'),
  // kie.ai (P2-A) — placeholders only in .env.example; never commit real keys
  KIE_BASE_URL: z.string().url().optional(),
  KIE_API_KEY: z.string().optional(),
  KIE_MODEL_GENERATE: z.string().optional(),
  KIE_MODEL_EDIT: z.string().optional(),
  KIE_WEBHOOK_HMAC_KEY: z.string().optional(),
  KIE_ESTIMATED_CREDITS_PER_IMAGE: z.string().optional(),
  KIE_USD_PER_CREDIT: z.string().optional(),
  KIE_CREATE_RATE_MAX: z.string().optional(),
  KIE_CREATE_RATE_WINDOW_MS: z.string().optional(),
  KIE_WORKER_CONCURRENCY_CAP: z.string().optional(),
  PROVIDER_POLL_INTERVAL_MS: z.string().optional(),
  // V2 planner agent — real LLM planner via kie.ai OpenAI-compatible chat
  // completions (reuses KIE_API_KEY). Default fake (offline deterministic).
  PLANNER_PROVIDER: z.enum(['fake', 'kie']).default('fake'),
  KIE_LLM_MODEL: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export type LoadEnvOptions = {
  /** When true (or NODE_ENV=production), AUTH_SECRET and DATABASE_URL are required strictly. */
  production?: boolean;
};

/**
 * Validate process.env with Zod. Fail-fast in production if required vars are missing.
 */
export function loadEnv(
  raw: NodeJS.ProcessEnv = process.env,
  options: LoadEnvOptions = {},
): AppEnv {
  const isProd = options.production === true || raw.NODE_ENV === 'production';

  const result = envSchema.safeParse({
    ...raw,
    DATABASE_URL: raw.DATABASE_URL ?? (isProd ? undefined : 'postgresql://studio:studio@localhost:5432/studio?schema=public'),
  });

  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }

  const env = result.data;

  if (isProd) {
    if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
      throw new Error('AUTH_SECRET (min 32 chars) is required in production');
    }
    if (!raw.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in production');
    }
  }

  return env;
}
