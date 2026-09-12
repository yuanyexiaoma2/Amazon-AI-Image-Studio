# W8-06 — A11y / empty / error / browser compat (cheap fixes)

## UI changes

- **Review:** `main` landmark, `aria-live` status, load error + Retry, empty-state copy, labeled selects/buttons.
- **Studio:** narrow viewport `role="alert"`, canvas `role="application"`, node library `aria-label`, status `aria-live`, task-drawer empty `role="status"`.

## Browser matrix (manual smoke — Chromium / Firefox / Safari last 2)

| Browser | Studio canvas | Review | Notes |
|---|---|---|---|
| Chromium | OK (primary) | OK | Dev target |
| Firefox | OK expected | OK | CSS grid / React Flow |
| Safari | OK expected | OK | Avoid relying on `:has` for critical paths |
| Mobile &lt;1280 | Blocked with alert | Readable | Spec: desktop Studio |

No IE11 support.
