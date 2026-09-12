/**
 * Prompt / reference strategy templates (W8-02).
 * Tuned against main Fake failure types: STRUCTURE_CHANGE, LOGO_CHANGE,
 * COMPOSITION_DRIFT, OVERLAY_TEXT, ATTACHMENT_COUNT.
 */

export type PromptSlot =
  | 'MAIN'
  | 'FEATURE'
  | 'DETAIL'
  | 'DIMENSION'
  | 'LIFESTYLE'
  | 'PACKAGE'
  | string;

export type PromptBuildInput = {
  slot: PromptSlot;
  purpose?: string;
  must?: string[];
  mustNot?: string[];
  /** When true, inject identity / silhouette / logo lock lines (default true for MAIN). */
  lockIdentity?: boolean;
};

const IDENTITY_MUST = [
  'preserve exact product silhouette and proportions (structure lock)',
  'preserve logo glyph, spelling, and placement (logo lock)',
  'keep camera framing close to the primary reference (composition lock)',
] as const;

const IDENTITY_MUST_NOT = [
  'do not alter product geometry, ports, or controls',
  'do not invent or move logos / printed text',
  'do not crop the product against the frame edge',
] as const;

export function shouldLockIdentity(slot: PromptSlot, explicit?: boolean): boolean {
  if (explicit != null) return explicit;
  return slot === 'MAIN' || slot === 'FEATURE' || slot === 'DETAIL';
}

/**
 * Build prompt text with W8-02 hardening lines for Fake failure modes.
 */
export function buildHardenedPromptText(input: PromptBuildInput): string {
  const must = [...(input.must ?? [])];
  const mustNot = [...(input.mustNot ?? [])];
  if (shouldLockIdentity(input.slot, input.lockIdentity)) {
    for (const line of IDENTITY_MUST) {
      if (!must.some((m) => m.toLowerCase().includes(line.slice(0, 24).toLowerCase()))) {
        must.push(line);
      }
    }
    for (const line of IDENTITY_MUST_NOT) {
      if (!mustNot.some((m) => m.toLowerCase().includes(line.slice(0, 20).toLowerCase()))) {
        mustNot.push(line);
      }
    }
  }
  const parts = [
    input.purpose?.trim() || '',
    must.length ? `Must: ${must.join('; ')}` : '',
    mustNot.length ? `Must not: ${mustNot.join('; ')}` : '',
    'Reference strategy: treat the first wired source_image as the identity reference; prefer it over lifestyle refs for geometry and logo.',
  ].filter(Boolean);
  return parts.join('\n');
}

export function buildHardenedNegative(mustNot: string[] | undefined, slot: PromptSlot): string {
  const base = [...(mustNot ?? [])];
  if (shouldLockIdentity(slot)) {
    for (const line of IDENTITY_MUST_NOT) {
      if (!base.includes(line)) base.push(line);
    }
  }
  return base.join('; ');
}
