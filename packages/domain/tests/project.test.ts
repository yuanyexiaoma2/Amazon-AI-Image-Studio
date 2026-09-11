import { describe, expect, it } from 'vitest';
import { assertSku } from '../src/project.js';

describe('assertSku', () => {
  it('accepts a normal SKU', () => {
    expect(() => assertSku('MUG-BLK-450')).not.toThrow();
  });

  it('rejects empty SKU', () => {
    expect(() => assertSku('')).toThrow(/required/);
  });
});
