/**
 * Sliding-window create-task rate limiter (kie.ai: ~20 creates / 10s per account).
 * Pure in-process; coordinates a single worker process. Multi-worker deploy should
 * keep WORKER_CONCURRENCY low enough that sum ≤ 20/10s, or use Redis later.
 */

export type CreateRateLimiterOptions = {
  maxCreates: number;
  windowMs: number;
  now?: () => number;
};

export class CreateRateLimiter {
  private readonly timestamps: number[] = [];
  private readonly maxCreates: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: CreateRateLimiterOptions) {
    this.maxCreates = Math.max(1, options.maxCreates);
    this.windowMs = Math.max(1, options.windowMs);
    this.now = options.now ?? (() => Date.now());
  }

  /** Throws if admitting would exceed the window; otherwise records the create. */
  tryAcquire(): { ok: true } | { ok: false; retryAfterMs: number } {
    const t = this.now();
    this.prune(t);
    if (this.timestamps.length >= this.maxCreates) {
      const oldest = this.timestamps[0]!;
      return { ok: false, retryAfterMs: Math.max(1, oldest + this.windowMs - t) };
    }
    this.timestamps.push(t);
    return { ok: true };
  }

  /** Current create count inside the window (for tests / metrics). */
  currentCount(): number {
    this.prune(this.now());
    return this.timestamps.length;
  }

  private prune(t: number): void {
    const cutoff = t - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }
}

/** kie.ai documented default: 20 new generation requests per 10 seconds. */
export const KIE_DEFAULT_CREATE_RATE = { maxCreates: 20, windowMs: 10_000 } as const;
