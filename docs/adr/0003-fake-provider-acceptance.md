# ADR-0003: Fake-provider acceptance while external deps deferred

- Status: Accepted (amended P2-A / MSG-035 — formal eval recovery narrowed)
- Date: 2026-09-12
- Deciders: Project owner (裁决 via Kimi MSG-016) + implementing agent (马奇)
- Related: ADR-0001 (Fake Provider default), Kimi MSG-016 on issue #7

## Context

Spec v1.1 assumes Staging real Provider keys (`W0-02`) and ~10 rights-cleared SKU fixtures (`W2-07`) before week-5/6 acceptance language such as:

- §19.5 week gate: each node has at least one **real Provider** success case (and a failure case).
- `W4-07` Staging real generate/edit smoke.
- W6 eval against real product baselines.

The project owner decided (2026-09-12) that **real Provider key selection** and **real SKU material collection** are deferred until **all development is complete**. Until then we must not block delivery, invent keys, or scrape unauthorized assets.

## Decision

1. **`W0-02`, `W2-07`, and `W4-07` remain `BLOCKED_EXTERNAL`.** Ledger remarks:  
   `所有者裁决：推迟至开发全部完成后决定（密钥选型 + 素材收集）`.

2. **W5 node acceptance (dev phase)** uses the **Fake Provider success + failure matrix** established in W4-06 as the substitute for “real Provider success case.” Spec §19.5 “真实成功案例” items are **suspended** (挂起), recorded in `docs/progress.md`, and do **not** stop W5/W6 implementation.

3. **W6 acceptance splits into two phases:**
   - **Phase 1 (during development):** 3 synthetic SKUs + Fake Provider prove QA mechanics (rule engine, Findings, STALE propagation, human approve loop, export).
   - **Phase 2 (after keys + real materials arrive):** real smoke + real baseline eval; issues found then are handled as **new CRs**, not as W6 rework debt.

4. Any acceptance criterion that cannot be met **only** because real keys/materials are missing: **挂起 → 记入账本 → 继续推进**. No stop-and-escalate solely for those gaps (Kimi MSG-016 §④e).

5. Production still must not store real provider secrets in the repo; when keys eventually arrive they follow ADR-0001 / secret-store rules.

## Consequences

### Positive
- Continuous delivery of W5–W8 without waiting on procurement.
- Clear audit trail for Fake-only gates vs future real smoke.
- Avoids fake “VERIFIED” claims against real-Provider language.

### Risks
- Fake adapters may miss provider-specific quirks until Phase 2.
- Team must not treat Phase 1 green as production readiness for paid real models.

### Recovery conditions (lift BLOCKED_EXTERNAL)
1. Owner supplies Provider credentials via approved secret path + budget.
2. Owner supplies ≥10 rights-cleared SKUs in existing `fixtures/eval-products/` format (or documented successor).
3. Open CR(s) for Phase 2 smoke/eval; update progress rows to DONE/VERIFIED with evidence; do **not** rewrite Phase 1 history.

### Recovery condition — formal eval / UAT (MSG-035 / MSG-036)

Product is currently **owner self-use** (not public release). Acceptance for the P2-A kie.ai plug-and-play gateway is **owner real trial**, not a formal eval / UAT gate.

**Revive formal eval / §18.4 baseline / multi-reviewer UAT only if** the product becomes **multi-user or company formal use**. Until then, do not block self-use delivery on W2-07 / W4-07 / §18.4 / W9-02 formal artifacts.

P2-A (`IMAGE_PROVIDER=kie`, `KieImageProviderAdapter`) may ship while those ledger rows stay non-VERIFIED / BLOCKED_EXTERNAL with MSG-035 wording.

## Alternatives considered

1. **Stop W5 until keys/SKUs** — rejected by owner裁决.
2. **Hard-code third-party free APIs** — rejected (capability/ToS/secret risk; conflicts ADR-0001).
3. **Mark real-Provider gates VERIFIED on Fake alone** — rejected (audit lie); we **suspend** them instead.

## Follow-ups

- W5-A may ship webhook early-arrival reconcile (审稿评估, non-blocking on W4).
- After W5-A merges: docs-only PR to clear VERIFIED backlog for W3-A/B1/B2/W4 (merge SHA + CI + 审稿 APPROVED).
