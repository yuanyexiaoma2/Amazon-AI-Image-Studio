import { describe, expect, it } from 'vitest';
import { handleHealthJob } from '../src/jobs/health.js';

describe('handleHealthJob', () => {
  it('returns ok payload', async () => {
    const result = await handleHealthJob({
      id: '1',
      data: { ping: 'test' },
    } as never);
    expect(result.ok).toBe(true);
    expect(result.ping).toBe('test');
  });
});
