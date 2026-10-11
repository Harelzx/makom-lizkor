# Public production release, 11 October 2026

Harel explicitly authorized deploying after all checks pass, importing the real places, and opening production to visitors. This replaces the earlier owner-only commissioning constraint. No purchase, extra resource or scope is needed. The HTTPS origin is `https://makom-lizkor.makom-staging.workers.dev`.

The completed production commissioning already demonstrated actual contact mail, submission verification/tracking/approval mail, real managed Turnstile, media publication, owner moderation, encrypted backup, withdrawal and isolated recovery without resurrection. The original evidence remains in `../agent-evidence/launch-readiness-20261010/manual-commissioning-20261011/`. Do not repeat destructive exercises or alter the regular export/drill cadence. RETENTION and MAILBOX verification is operational; physical erasure is unmeasured.

## Delivery order

1. Commit the owner import UI and the separate Workers Access release guard. Require ordinary full CI, exact planned/executed browser coverage and automatic staging of the same SHA with all nine receipt checks passing.
2. Build a secret-free production package with the existing real Turnstile sitekey and configuration. Check every existing mail, moderator, registry, backup, cache, retention and notice requirement. The legacy custom-domain checks remain strict. For this exact workers.dev origin, additionally require a fresh live API inventory proving whole-Worker Access, the exact owner policy and disabled version previews; a local configuration or stale receipt is insufficient.
3. Deploy that exact source while production remains owner-only. Compare the active version, Access and normal job records with the saved state.
4. Select the prepared local JSON packet in the owner's normal admin session. The packet contains 90 curated places and 32 photo entries (29 distinct licensed files); its source fixture hash is `06b2ea092565fb6697fb0b5a4ab8582305971aaff25274f020e6a5570f09861d`. All records, sources, credits and image bytes are validated before the first upload. Existing moderation routes publish them with normal validation, ledger and visibility rules. Existing records are skipped whole. No direct database import, machine identity or extracted browser credential is used. The packet is private and is not included in the site bundle.
5. Immediately before opening visitors, save a fresh Access snapshot. Apply only the public path overrides exported by `scripts/release-workers-access.mjs` to the existing host destination. Keep the whole-Worker default protected and preserve the audience, owner identity and policy. Read back the complete policy/inventory and compare; unexpected drift requires restoring the previous Access configuration.
6. Without cookies, verify the site, assets, font licenses, versioned feed, real place, share card and public photo. Verify admin, operations, health, commissioning, development, preview login and unknown paths stay protected. Public write routes still require their existing validation, Turnstile or tracking capability. Inspect the live desktop and narrow screen in additional browser tabs, preserving Harel's tab.

The Access API permits at most25 overrides per destination. The plan uses25: canonical visitor URLs, static assets, and the submission tracking subtree (whose capabilities remain verified by the Worker). Optional slash aliases and `/index.html` are not public entry points. No broad `/api/*`, `/media/*` or whole-site wildcard is allowed. Font licenses have explicit directory/file rules.

## Local verification and limitation

The final-build owner import test uses the real moderation/photo routes and checks public feed publication plus unchanged retry. A second test proves invalid input cannot initiate writes. Packet unit tests cover incomplete records, sources, duplicate identifiers, missing images, traversal and invalid image payloads. Access guard tests reject wrong identity/origin, stale or incomplete snapshots, shadow applications, broad paths and expanded policies. Review is by the root agent, not an independent reviewer.

An initial browser test requested the feed without the mandatory version parameter and received `stale_version`; the test request was corrected without changing server behavior. Its original trace/log are preserved. The Cloudflare CLI login alternative was rejected by automatic approval review despite the owner's focused permission; it was abandoned in favor of this ordinary owner UI.

CI completion, production import and public opening are not established by this plan. Record actual SHA, versions, counts, readbacks and screenshots after they occur. Browser checks do not prove a physical iPhone or a real WhatsApp preview.
