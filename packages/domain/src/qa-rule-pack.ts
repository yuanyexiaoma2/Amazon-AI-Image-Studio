/**
 * Market Rule Pack — spec §11.3 / §31.15 / §32.13.
 * Thresholds live in versioned JSON, not scattered constants.
 */

import { canonicalizeJcs } from './jcs.js';
import { sha256Hex } from './sha256.js';
import { AMAZON_MAIN_US_V1 } from './qa-rules/amazon-main-us-v1.js';

export const MARKETPLACE_CODES = [
  'US',
  'CA',
  'MX',
  'UK',
  'DE',
  'FR',
  'IT',
  'ES',
  'JP',
  'AU',
] as const;
export type MarketplaceCode = (typeof MARKETPLACE_CODES)[number];

export const RULE_TYPES = [
  'DETERMINISTIC',
  'DETERMINISTIC_WITH_SEGMENTATION',
  'OCR',
  'HYBRID',
  'VISION_WITH_TRUTH',
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const RULE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

export const SEVERITY_RANK: Record<RuleSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export type RuleScope = {
  type: 'CATEGORY_PREFIX' | 'CATEGORY_EXACT' | 'GENERIC';
  value: string;
  specificity: number;
};

export type MarketRule = {
  ruleId: string;
  evaluator: string;
  type: RuleType;
  severity: RuleSeverity;
  nonWaivable: boolean;
  params: Record<string, unknown>;
};

export type MarketRulePack = {
  schemaVersion: number;
  key: string;
  version: number;
  marketplaceCode: MarketplaceCode;
  scope: RuleScope;
  priority: number;
  effectiveDate: string;
  rules: MarketRule[];
  sourceUrls: string[];
  changeRequestId?: string;
};

export type RulePackMergeInput = {
  packs: MarketRulePack[];
  marketplaceCode: MarketplaceCode;
  category?: string | null;
};

export type RulePackMergeResult =
  | { ok: true; pack: MarketRulePack; sha256: string; canonicalJson: string }
  | { ok: false; reason: string };

export function isMarketplaceCode(v: string): v is MarketplaceCode {
  return (MARKETPLACE_CODES as readonly string[]).includes(v);
}

export function validateMarketRulePack(
  pack: MarketRulePack,
): { ok: true } | { ok: false; reason: string } {
  if (pack.schemaVersion !== 1) return { ok: false, reason: 'schemaVersion must be 1' };
  if (!pack.key || !pack.key.trim()) return { ok: false, reason: 'key required' };
  if (!Number.isInteger(pack.version) || pack.version < 1) {
    return { ok: false, reason: 'version must be a positive integer' };
  }
  if (!isMarketplaceCode(pack.marketplaceCode)) {
    return { ok: false, reason: `unsupported marketplaceCode ${pack.marketplaceCode}` };
  }
  if (!Array.isArray(pack.rules) || pack.rules.length === 0) {
    return { ok: false, reason: 'rules must be a non-empty array' };
  }
  const seen = new Set<string>();
  for (const rule of pack.rules) {
    if (!rule.ruleId) return { ok: false, reason: 'ruleId required' };
    if (seen.has(rule.ruleId)) return { ok: false, reason: `duplicate ruleId ${rule.ruleId}` };
    seen.add(rule.ruleId);
    if (!(RULE_TYPES as readonly string[]).includes(rule.type)) {
      return { ok: false, reason: `invalid type ${rule.type} on ${rule.ruleId}` };
    }
    if (!(RULE_SEVERITIES as readonly string[]).includes(rule.severity)) {
      return { ok: false, reason: `invalid severity ${rule.severity} on ${rule.ruleId}` };
    }
    if (!rule.evaluator) return { ok: false, reason: `evaluator required on ${rule.ruleId}` };
  }
  return { ok: true };
}

function categoryMatches(pack: MarketRulePack, category: string | null | undefined): boolean {
  if (pack.scope.type === 'GENERIC' || pack.scope.specificity === 0) return true;
  if (!category) return false;
  if (pack.scope.type === 'CATEGORY_EXACT') return category === pack.scope.value;
  return category === pack.scope.value || category.startsWith(`${pack.scope.value}`);
}

/**
 * Merge activated packs: filter marketplace + category, apply by
 * scope.specificity ASC then priority ASC. Same ruleId: latter replaces former.
 * Same specificity+priority with different content → fail.
 * Lowering severity or flipping nonWaivable true→false requires changeRequestId.
 */
export function mergeMarketRulePacks(input: RulePackMergeInput): RulePackMergeResult {
  const candidates = input.packs.filter(
    (p) => p.marketplaceCode === input.marketplaceCode && categoryMatches(p, input.category),
  );
  if (candidates.length === 0) {
    return { ok: false, reason: `no active rule pack for marketplace ${input.marketplaceCode}` };
  }

  const sorted = [...candidates].sort((a, b) => {
    if (a.scope.specificity !== b.scope.specificity) {
      return a.scope.specificity - b.scope.specificity;
    }
    return a.priority - b.priority;
  });

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (
        a.scope.specificity === b.scope.specificity &&
        a.priority === b.priority &&
        a.key !== b.key
      ) {
        const ca = canonicalizeJcs({ rules: a.rules, scope: a.scope });
        const cb = canonicalizeJcs({ rules: b.rules, scope: b.scope });
        if (ca !== cb) {
          return {
            ok: false,
            reason: `conflicting packs ${a.key}@${a.version} and ${b.key}@${b.version} share specificity+priority`,
          };
        }
      }
    }
  }

  const byId = new Map<string, MarketRule>();
  const origin = new Map<string, MarketRulePack>();
  for (const pack of sorted) {
    const v = validateMarketRulePack(pack);
    if (!v.ok) return v;
    for (const rule of pack.rules) {
      const prev = byId.get(rule.ruleId);
      if (prev) {
        const prevPack = origin.get(rule.ruleId)!;
        const lowered =
          SEVERITY_RANK[rule.severity] < SEVERITY_RANK[prev.severity] ||
          (prev.nonWaivable && !rule.nonWaivable);
        if (lowered && !pack.changeRequestId) {
          return {
            ok: false,
            reason: `${pack.key} lowers ${rule.ruleId} vs ${prevPack.key} without changeRequestId`,
          };
        }
      }
      byId.set(rule.ruleId, rule);
      origin.set(rule.ruleId, pack);
    }
  }

  const last = sorted[sorted.length - 1]!;
  const merged: MarketRulePack = {
    schemaVersion: 1,
    key: last.key,
    version: last.version,
    marketplaceCode: input.marketplaceCode,
    scope: last.scope,
    priority: last.priority,
    effectiveDate: last.effectiveDate,
    rules: [...byId.values()],
    sourceUrls: [...new Set(sorted.flatMap((p) => p.sourceUrls))],
  };
  const canonicalJson = canonicalizeJcs(merged);
  return { ok: true, pack: merged, sha256: sha256Hex(canonicalJson), canonicalJson };
}

export function loadBuiltinRulePack(key = 'amazon-main-us-v1'): MarketRulePack {
  if (key !== 'amazon-main-us-v1') {
    throw new Error(`unknown builtin rule pack: ${key}`);
  }
  return structuredClone(AMAZON_MAIN_US_V1);
}

export function builtinAmazonMainUsV1Merged(): {
  pack: MarketRulePack;
  sha256: string;
  canonicalJson: string;
} {
  const merged = mergeMarketRulePacks({
    packs: [loadBuiltinRulePack()],
    marketplaceCode: 'US',
    category: 'GENERIC_NON_APPAREL',
  });
  if (!merged.ok) throw new Error(merged.reason);
  return { pack: merged.pack, sha256: merged.sha256, canonicalJson: merged.canonicalJson };
}
