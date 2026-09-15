'use client';

/**
 * V2 PR-1 — pipeline stepper （素材 → Truth Pack → Shot Plan → 画布 → 审核导出）.
 * Steps are clickable; completion comes from the pure `deriveProjectStep`.
 */
import Link from 'next/link';
import { useWorkspace } from '@/lib/use-workspace';
import {
  deriveProjectStep,
  type ProjectStepInput,
  type ProjectStepKey,
} from '@/lib/project-step';

const STEP_DEFS: Array<{
  key: ProjectStepKey;
  label: string;
  href: (projectId: string) => string;
}> = [
  { key: 'assets', label: '素材', href: (id) => `/projects/${id}` },
  { key: 'truth', label: 'Truth Pack', href: (id) => `/projects/${id}#truth-pack` },
  { key: 'shotPlan', label: 'Shot Plan', href: (id) => `/projects/${id}#shot-plan` },
  { key: 'canvas', label: '画布', href: (id) => `/projects/${id}/studio` },
  { key: 'review', label: '审核导出', href: (id) => `/projects/${id}/review` },
];

export function ProjectStepper(props: { projectId: string; input: ProjectStepInput }) {
  const { projectHref } = useWorkspace();
  const { steps, current } = deriveProjectStep(props.input);

  return (
    <nav aria-label="项目步骤" className="stepper">
      {steps.map((s, i) => (
        <Link
          key={s.key}
          href={projectHref(STEP_DEFS[i].href(props.projectId))}
          aria-current={s.key === current ? 'step' : undefined}
          className={`stepper-step stepper-${s.status}`}
        >
          <span className="stepper-marker" aria-hidden="true">
            {s.status === 'done' ? '✓' : i + 1}
          </span>
          {STEP_DEFS[i].label}
        </Link>
      ))}
    </nav>
  );
}
