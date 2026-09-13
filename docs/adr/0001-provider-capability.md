# ADR-0001: Image Provider Capability (Fake Provider default)

- Status: Accepted
- Date: 2026-09-11
- Deciders: Project owner + implementing agent

## Context

W0-02 requires freezing provider/model capability before paying for real image generation.
Real provider API keys and spend authorization are not yet available from the product owner
(see spec §3.2 / §31.3). Development must not block on external credentials.

## Decision

1. Default `IMAGE_PROVIDER=fake` for all local/CI development.
2. Implement a replaceable `ImageProvider` port in `packages/providers`.
3. Ship `FakeImageProvider` with a deterministic success path (tiny PNG) and unit tests.
4. Real provider integrations (OpenAI / Google / others) remain **BLOCKED_EXTERNAL** until:
   - API keys are provided, and
   - spend/budget authorization is explicit.
5. Model IDs and capability tables for production providers will be appended to this ADR
   when keys are authorized (do not invent production model IDs).

## Consequences

- Pipelines, worker jobs, QA, and UI can proceed offline against Fake Provider.
- No accidental paid API calls in MVP scaffold.
- Switching providers later requires only an adapter + env change, not domain rewrites.

## Alternatives considered

1. Hard-code a single cloud SDK in the worker — rejected (violates replaceable-provider rule).
2. Block all generation work until keys arrive — rejected (slows W1–W5).


## Amendment (P2-A / 2026-09-13)

Authorized third-party gateway for owner self-use: **kie.ai** (`IMAGE_PROVIDER=kie`).

- Adapter: `KieImageProviderAdapter` in `packages/providers`
- Auth: `Authorization: Bearer <KIE_API_KEY>`
- Jobs: `POST /api/v1/jobs/createTask`, poll `GET /api/v1/jobs/recordInfo?taskId=`
- Credits: documented `GET /api/v1/chat/credit`
- Default Market models (override via env with real docs IDs only):
  - Generate: `seedream/5-pro-text-to-image`
  - Edit: `seedream/5-pro-image-to-image`
- Estimate: ~7 credits × $0.005/credit (docs callback example + kie billing UI) — not an invented SKU price list
- Secrets remain env / secret-store only; never in repo
