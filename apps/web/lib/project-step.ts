/**
 * V2 PR-1 — pure step-completion derivation for the project stepper.
 * Kept free of React/fetch so it is unit-testable in node.
 *
 * A step counts as done when its own signal is true OR any later step's
 * signal is true (progress evidence — e.g. an existing workflow implies
 * assets/truth/shot-plan were completed). The current step is the first
 * not-done step; when everything is done the final review step is current.
 */

export type ProjectStepKey = 'assets' | 'truth' | 'shotPlan' | 'canvas' | 'review';

export type ProjectStepStatus = 'done' | 'current' | 'todo';

export type ProjectStep = { key: ProjectStepKey; status: ProjectStepStatus };

export type ProjectStepInput = {
  /** Project has at least one uploaded asset. */
  hasAssets?: boolean;
  /** Truth Pack has an approved revision. */
  truthApproved?: boolean;
  /** Shot Plan has an approved revision. */
  shotPlanApproved?: boolean;
  /** A canvas workflow exists (materialized or blank). */
  hasWorkflow?: boolean;
  /** At least one QA report exists. */
  hasQaReports?: boolean;
};

export const PROJECT_STEP_ORDER: readonly ProjectStepKey[] = [
  'assets',
  'truth',
  'shotPlan',
  'canvas',
  'review',
];

export function deriveProjectStep(input: ProjectStepInput): {
  steps: ProjectStep[];
  current: ProjectStepKey;
} {
  const signals: Record<ProjectStepKey, boolean> = {
    assets: input.hasAssets === true,
    truth: input.truthApproved === true,
    shotPlan: input.shotPlanApproved === true,
    canvas: input.hasWorkflow === true,
    review: input.hasQaReports === true,
  };
  const done = PROJECT_STEP_ORDER.map((key, i) =>
    PROJECT_STEP_ORDER.slice(i).some((later) => signals[later]),
  );
  const currentIndex = done.findIndex((d) => !d);
  const current =
    PROJECT_STEP_ORDER[currentIndex === -1 ? PROJECT_STEP_ORDER.length - 1 : currentIndex];
  return {
    steps: PROJECT_STEP_ORDER.map((key, i) => ({
      key,
      status: key === current ? 'current' : done[i] ? 'done' : 'todo',
    })),
    current,
  };
}
