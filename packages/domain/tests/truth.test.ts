import { describe, expect, it } from 'vitest';
import { canApproveTruthRevision, canRoleApproveTruth, canTransitionFact } from '../src/truth.js';

describe('truth pack gates', () => {
  it('allows EXTRACTED -> CONFIRMED', () => {
    expect(canTransitionFact('EXTRACTED', 'CONFIRMED')).toBe(true);
  });

  it('blocks approve while EXTRACTED facts remain', () => {
    const r = canApproveTruthRevision([
      { status: 'CONFIRMED' },
      { status: 'EXTRACTED' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('allows approve when all non-rejected are confirmed/locked', () => {
    const r = canApproveTruthRevision([
      { status: 'CONFIRMED' },
      { status: 'LOCKED' },
      { status: 'REJECTED' },
    ]);
    expect(r.ok).toBe(true);
  });

  it('rejects empty fact list', () => {
    expect(canApproveTruthRevision([]).ok).toBe(false);
  });

  it('only OWNER ADMIN REVIEWER may approve', () => {
    expect(canRoleApproveTruth('MEMBER')).toBe(false);
    expect(canRoleApproveTruth('OWNER')).toBe(true);
    expect(canRoleApproveTruth('ADMIN')).toBe(true);
    expect(canRoleApproveTruth('REVIEWER')).toBe(true);
  });
});
