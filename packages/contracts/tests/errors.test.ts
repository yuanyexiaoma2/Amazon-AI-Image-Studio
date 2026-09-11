import { describe, expect, it } from 'vitest';
import { makeApiError } from '../src/errors.js';

describe('makeApiError', () => {
  it('builds unified error envelope with requestId', () => {
    const err = makeApiError('VALIDATION_ERROR', 'bad input', 'req-1');
    expect(err.error.code).toBe('VALIDATION_ERROR');
    expect(err.error.requestId).toBe('req-1');
  });
});
