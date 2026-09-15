import { describe, expect, it } from 'vitest';
import { deriveProjectStep, PROJECT_STEP_ORDER } from '@/lib/project-step';

describe('deriveProjectStep', () => {
  it('empty project starts at assets with everything todo', () => {
    const r = deriveProjectStep({});
    expect(r.current).toBe('assets');
    expect(r.steps.map((s) => s.status)).toEqual([
      'current',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
  });

  it('assets done moves current to truth', () => {
    const r = deriveProjectStep({ hasAssets: true });
    expect(r.current).toBe('truth');
    expect(r.steps[0]).toEqual({ key: 'assets', status: 'done' });
  });

  it('approved truth pack moves current to shotPlan', () => {
    const r = deriveProjectStep({ hasAssets: true, truthApproved: true });
    expect(r.current).toBe('shotPlan');
  });

  it('approved shot plan moves current to canvas', () => {
    const r = deriveProjectStep({ shotPlanApproved: true });
    expect(r.current).toBe('canvas');
    // earlier steps inferred done from later-step evidence
    expect(r.steps.find((s) => s.key === 'truth')?.status).toBe('done');
  });

  it('existing workflow marks canvas done, review current', () => {
    const r = deriveProjectStep({ hasWorkflow: true });
    expect(r.current).toBe('review');
    expect(r.steps.filter((s) => s.status === 'done').map((s) => s.key)).toEqual([
      'assets',
      'truth',
      'shotPlan',
      'canvas',
    ]);
  });

  it('QA reports mark everything done, review stays current', () => {
    const r = deriveProjectStep({
      hasAssets: true,
      truthApproved: true,
      shotPlanApproved: true,
      hasWorkflow: true,
      hasQaReports: true,
    });
    expect(r.current).toBe('review');
    expect(r.steps.every((s) => s.status !== 'todo')).toBe(true);
    expect(r.steps.filter((s) => s.status === 'done')).toHaveLength(
      PROJECT_STEP_ORDER.length - 1,
    );
  });

  it('step order matches the production pipeline', () => {
    expect(PROJECT_STEP_ORDER).toEqual(['assets', 'truth', 'shotPlan', 'canvas', 'review']);
  });

  it('explicit false signals do not count as done', () => {
    const r = deriveProjectStep({ hasAssets: false, truthApproved: false });
    expect(r.current).toBe('assets');
  });

  it('review evidence alone implies the whole chain done', () => {
    const r = deriveProjectStep({ hasQaReports: true });
    expect(r.steps.filter((s) => s.status === 'done')).toHaveLength(
      PROJECT_STEP_ORDER.length - 1,
    );
  });

  it('gap in the middle keeps earlier steps done but current at the gap', () => {
    const r = deriveProjectStep({ hasAssets: true, hasWorkflow: true });
    expect(r.current).toBe('review');
    expect(r.steps.find((s) => s.key === 'assets')?.status).toBe('done');
    expect(r.steps.find((s) => s.key === 'shotPlan')?.status).toBe('done');
  });
});
