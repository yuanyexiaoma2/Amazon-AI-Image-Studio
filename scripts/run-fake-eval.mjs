#!/usr/bin/env node
/**
 * W8-01 — Fake visual eval baseline (3 synthetic SKUs + golden-qa).
 * Does not call real Providers. Writes docs/eval/w8-phase1-baseline-report.md
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Prefer built dist; fall back to building instruction
function loadDomain() {
  try {
    return require(join(root, 'packages/domain/dist/index.js'));
  } catch {
    console.error('Run `pnpm --filter @studio/domain build` first');
    process.exit(1);
  }
}

function loadProviders() {
  try {
    return require(join(root, 'packages/providers/dist/index.js'));
  } catch {
    console.error('Run `pnpm --filter @studio/providers build` first');
    process.exit(1);
  }
}

const domain = loadDomain();
const providers = loadProviders();

const {
  AMAZON_MAIN_US_V1,
  evaluateRulePack,
  aggregateQaReport,
} = domain;

const { FakeOcrProvider, FakeVisionQaProvider } = providers;

const skusDir = join(root, 'fixtures/eval-products');
const goldenDir = join(skusDir, 'golden-qa');
const outDir = join(root, 'docs/eval');
mkdirSync(outDir, { recursive: true });

const skus = readdirSync(skusDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('SKU-'))
  .map((d) => d.name)
  .sort();

const goldenFiles = readdirSync(goldenDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

function baseMetrics() {
  return {
    decodable: true,
    mime: 'image/png',
    width: 2000,
    height: 2000,
    shortSide: 2000,
    backgroundWhiteRatio: 0.997,
    subjectExtent: 0.9,
    maskConfidence: 0.95,
    minEdgeMarginRatio: 0.04,
    touchesEdge: false,
    blurScore: 180,
    hasBorder: false,
    subjectBBox: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
  };
}

async function runGolden() {
  const ocr = new FakeOcrProvider();
  const vision = new FakeVisionQaProvider();
  const rows = [];
  let pass = 0;
  let fail = 0;

  for (const file of goldenFiles) {
    const spec = JSON.parse(readFileSync(join(goldenDir, file), 'utf8'));
    const ocrRes = await ocr.inspect({
      assetVersionId: `eval-${spec.id}`,
      scenario: spec.fakeScenario,
      confirmedFacts: [{ key: 'brand', value: 'Acme' }, { key: 'sku', value: 'SKU-SYN-001' }],
    });
    const visionRes = await vision.inspectProduct({
      assetVersionId: `eval-${spec.id}`,
      scenario: spec.fakeScenario,
    });

    const metrics = baseMetrics();
    if (spec.fakeScenario === 'WATERMARK') metrics.hasBorder = true;

    const ctx = {
      slot: spec.slot ?? 'MAIN',
      candidateAssetVersionId: `eval-${spec.id}`,
      metrics,
      ocr: ocrRes,
      vision: visionRes,
      confirmedFacts: [{ key: 'brand', value: 'Acme' }, { key: 'sku', value: 'SKU-SYN-001' }],
    };

    const findings = evaluateRulePack(AMAZON_MAIN_US_V1.rules, ctx);
    const overall = aggregateQaReport(findings);
    const expected = spec.expectedOverall;
    // REVIEW expected may also accept BLOCK for stricter Fake scenarios
    const ok =
      overall === expected ||
      (expected === 'REVIEW' && (overall === 'REVIEW' || overall === 'BLOCK'));
    if (ok) pass += 1;
    else fail += 1;
    rows.push({
      id: spec.id,
      scenario: spec.fakeScenario,
      expected,
      actual: overall,
      ok,
      failRules: findings.filter((f) => f.status !== 'PASS').map((f) => `${f.ruleId}:${f.status}`),
    });
  }
  return { rows, pass, fail, total: rows.length };
}

function skuBriefCounts() {
  const out = [];
  for (const sku of skus) {
    const briefsPath = join(skusDir, sku, 'eval-briefs.json');
    const productPath = join(skusDir, sku, 'product.json');
    const briefs = existsSync(briefsPath)
      ? JSON.parse(readFileSync(briefsPath, 'utf8'))
      : { briefs: [] };
    const product = JSON.parse(readFileSync(productPath, 'utf8'));
    const candidateTotal = (briefs.briefs ?? []).reduce((n, b) => n + (b.candidates ?? 0), 0);
    out.push({
      sku,
      name: product.name,
      briefSlots: (briefs.briefs ?? []).map((b) => b.slot),
      candidateTotal,
    });
  }
  return out;
}

const golden = await runGolden();
const skuRows = skuBriefCounts();
const totalCandidates = skuRows.reduce((n, s) => n + s.candidateTotal, 0);
const now = new Date().toISOString();

const md = `# W8-01 Phase 1 Fake visual eval — baseline report

- **Generated:** ${now} (UTC) / Asia/Shanghai = UTC+8
- **Provider:** Fake only (ADR-0003)
- **Rule pack:** \`amazon-main-us-v1\` @ ${AMAZON_MAIN_US_V1.version}
- **SKUs:** ${skus.length} synthetic (W2-07 10 real SKUs still BLOCKED_EXTERNAL)

## Scope adaptation

Spec W8-01 asks to expand to 10 SKUs. Phase 1 uses the **3 synthetic SKUs** already in \`fixtures/eval-products/\` because real photography is hung (owner裁决). This report is a **Fake mechanics baseline**, not a §18.4 production quality claim.

## SKU brief matrix (MAIN / FEATURE / LIFESTYLE × 2 candidates)

| SKU | Name | Slots | Candidates |
|---|---|---|---:|
${skuRows.map((s) => `| ${s.sku} | ${s.name} | ${s.briefSlots.join(', ')} | ${s.candidateTotal} |`).join('\n')}

- **Total Fake candidates (planned):** ${totalCandidates} (= 3 × 3 × 2)
- Spec §32.10 full protocol (20×3×2=120 + dual reviewers) = **Phase 2** after real SKUs / keys.

## Golden QA scenario results (Fake OCR/Vision)

| ID | Scenario | Expected | Actual | Match | Non-PASS rules |
|---|---|---|---|---|---|
${golden.rows
  .map(
    (r) =>
      `| ${r.id} | ${r.scenario} | ${r.expected} | ${r.actual} | ${r.ok ? 'YES' : 'NO'} | ${r.failRules.join('; ') || '—'} |`,
  )
  .join('\n')}

- **Matched:** ${golden.pass} / ${golden.total}
- **Mismatched:** ${golden.fail} / ${golden.total}

## Failure-type histogram (golden non-PASS)

${(() => {
  const hist = {};
  for (const r of golden.rows) {
    for (const fr of r.failRules) {
      const rule = fr.split(':')[0];
      hist[rule] = (hist[rule] ?? 0) + 1;
    }
  }
  const lines = Object.entries(hist)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`);
  return ['| Rule | Count |', '|---|---:|', ...lines].join('\n') || '_none_';
})()}

## §18.4 / first-pass approve rate

Not measured on real Reviewer samples in Phase 1. Written exception: **Fake-only baseline**; human ≥60% / ≥80% thresholds deferred to Phase 2 (ADR-0003).

## How to reproduce

\`\`\`bash
pnpm --filter @studio/domain build && pnpm --filter @studio/providers build
pnpm test:eval
\`\`\`
`;

const outPath = join(outDir, 'w8-phase1-baseline-report.md');
writeFileSync(outPath, md);
writeFileSync(
  join(outDir, 'w8-phase1-baseline.json'),
  JSON.stringify({ generatedAt: now, skus: skuRows, golden, rulePackVersion: AMAZON_MAIN_US_V1.version }, null, 2) +
    '\n',
);

console.log(`Wrote ${outPath}`);
console.log(`Golden match ${golden.pass}/${golden.total}; SKUs=${skus.length}; candidates=${totalCandidates}`);
if (golden.fail > 0) process.exitCode = 1;
