# Status checklist - 14 October 2026

A single view of what is done, what is open and who can close it. Built from Git, GitHub (PRs, runs, annotations), `src/config.ts`, `wrangler.jsonc`, `agent-handoff.md` and `checklist-closeout-20261013.md`, and checked against the live site. `go-live-checklist.md` and `launch-decisions.md` are historical planning (both carry banners saying so): their unchecked boxes are **not** reopened here.

## Where we are (14.10, 12:30 UTC)

- Production: release `309bc8e` (version `d89f89f2`, tag `release-309bc8eb69be`), 100% since 11:34 UTC on `https://makom-lizkor.makom-staging.workers.dev`. It adds the no-WebGL fallback (PR #16) to 799119e.
- Main is ahead of production by CI, test and dependency changes only: Ubuntu 26.04 runners (#15), Dependabot #4-#7, the compatibility fixes (#17). None changes what visitors get beyond the dependency bumps, which go out with the next release.
- Content: 90 curated records (68 memorials, 22 communities), 32 photo entries.

## Done (with evidence)

- [x] Public launch with real places, 11.10 (`agent-evidence/launch-readiness-20261010/public-launch-20261011/`).
- [x] Operator, contact and moderator set: `OPERATOR` in `src/config.ts`, `MODERATORS` in `wrangler.jsonc`, Gmail API as sender.
- [x] `MAILBOX.verified` and `RETENTION.verified` are `true`, backed by operational evidence (physical provider erasure is unmeasured, by design).
- [x] Backup, recovery drill, retention exercise (11.10).
- [x] Nine security and performance fixes, enforced CSP, image derivatives (13.10, `security-performance-20261012/`).
- [x] Live add, email verification, admin approval, three emails received, and withdrawal of the test place (13.10).
- [x] Keyboard location entry; GPS pin review that keeps the form (13.10). Owner confirmed it works on iPhone.
- [x] Anemones capped per address and place per day; foreign-site POSTs refused (PR #9, live).
- [x] Safari edge resampling and edge-attached mobile sheet (PR #10, live; still unproven on a real iPhone, below).
- [x] Own map tiles: Israel basemap from R2 (EU) and terrain as static files under `/assets/` (PRs #11, #13, live).
- [x] Migration 0022 applied to DB and DRILL_DB; schema 22.
- [x] MFA on all three accounts: owner-stated on 13.10.
- [x] **No-WebGL blank page fixed and live (PR #16, release 309bc8e).** Without WebGL2 MapLibre threw in `new Map()` and the whole page unmounted: an empty dark screen for anyone with hardware acceleration off, an old graphics driver or a locked-down machine. Now the film, list and cards work, map-only add-place controls hide (`store.mapMissing`), and a quiet line says «המפה לא נטענה בדפדפן הזה. כל המקומות זמינים ברשימה.». Independently reviewed (two findings, both fixed before merge). Verified live in Firefox and Chromium with WebGL off (`agent-evidence/release-nowebgl-20261014/`).
- [x] **GitHub Actions runs again.** The repository is public; manual runs and the scheduled availability run of 14.10 12:10 UTC all started and passed.
- [x] **CI on Ubuntu 26.04 (PR #15).** All 9 workflows name `ubuntu-26.04` ahead of `ubuntu-latest` moving on 19.10. Proven on that image: ci (with browser suites), staging, regression, availability, security, compatibility. Not yet: release.yml, rollback.yml (not used; releases run from the owner's Terminal kit).
- [x] **Weekly compatibility run green (PR #17)**, failing since 11.10. Desktop Firefox and WebKit run without WebGL (`noWebGL` fixture option): CI's runners have no GPU, Firefox there has no WebGL2 and WebKit drew the map at about 1.5 fps, auditing animations half-way. `audit()` now waits for finite running animations. Map coverage stays in Chromium. Run 38560837237.
- [x] **Dependabot #4, #5, #6, #7 merged** (`@types/node` 26, typescript-eslint, lucide-react, radix-ui); main CI, staging and regression green on the combination.
- [x] **Production releases by the agent:** a narrow rule in the untracked `web/.claude/settings.local.json` (owner-approved 14.10) lets a session write release kits under `agent-evidence/release-*` and run their `release.sh`. Every gate stays in the kit: same-SHA CI/staging/regression, main unmoved, no runtime drift or secrets in the package, no pending migration, one deploy attempt, Access probe before/after, live checks.

## Open - Harel only

- [ ] **Owner key backup.** Keep a protected copy of the owner (export) private key off this computer. Confirmed not done on 13.10.
- [ ] **iPhone Safari:** do the top/bottom edges match the map and sheet (no dark frame)? Does the folded sheet read as draggable? Both were rejected on c937da2; the fix live since 799119e is unproven on a real device.
- [ ] **iPhone at 200% text size:** add-a-place keeps all fields while picking a point.
- [ ] **WhatsApp share preview** of a real place link (L4).
- [ ] **Android phone** pass (map, list, add place, GPS).
- [ ] **Domain**: deliberately deferred. Decide only when ready; it triggers share-preview and mail checks again.
- [ ] **Two local drafts** in the owner's browser: keep or clear (not in the public feed).

## Open - agent

- [ ] **Dependabot #8** (maplibre-gl 6.11 -> 6.13): green; touches the map (self-contained worker, `maxBounds` now respects padding, terrain camera fixes). Merge, then look at staging before the next release.
- [ ] **Dependabot #1-#3** (actions/setup-node 7, upload-artifact 7, download-artifact 8): green; major versions of CI actions. One at a time now that Ubuntu 26.04 is settled.
- [ ] **Weekly security scan** on its own schedule (Mondays 07:17 UTC): confirm the run of 19.10. A manual run on 26.04 passed on 14.10.
- [ ] **Access API comparison** still refused (Cloudflare error 1010 on wrangler's login) at 799119e and 309bc8e; only the anonymous probe of 6 public and 8 private paths is compared. A verification gap, not a regression.
- [ ] **CI token scope check** blocked (API error 9109). Needs a token or dashboard read.
- [ ] **`launch/tiles-check/`** (6 screenshots, 14.10 10:38): keep as tiles-release evidence or delete.

## Open - external professionals (not started, no purchase approved)

- [ ] Legal review: database classification, transfer abroad, consumer Gmail contract basis, 24-month audit retention. Package listed in `checklist-closeout-20261013.md`.
- [ ] Manual screen reader pass (VoiceOver, NVDA) on all flows. The accessibility statement stays "partial" until then.
- [ ] External security review. Current reviews are by agents only.

## Known and deferred (not blockers)

- `/api/ops` reports `errors.status=unavailable`: production error-rate telemetry is not connected.
- 14 high audit entries in developer tooling (braces, Sharp); no deployed path. Do not force-downgrade the Cloudflare toolchain.
- `C-CACHE-TEST-1` historical failure, undiagnosed; recurrence stops the dependent deploy.
- No field Core Web Vitals; lab only (LCP 1.2 s, CLS 0.009).
- Without a map the sunrise is instant (both light shifts return at once); acceptable, noted in review.
- Content growth: family-built corners, outreach to communities and partners (historical lists in `go-live-checklist.md`).

## Next actions, in order

| # | Who | Action | Done when |
|---|-----|--------|-----------|
| 1 | Harel | iPhone Safari: edges, sheet, 200% text | Screenshot accepted, or a concrete fix request |
| 2 | Harel | Owner key backup off this computer | Owner confirms |
| 3 | Agent | Dependabot #8, then a release with the dependency bumps | Staging looked at, release kit green, live checks pass |
| 4 | Agent | Dependabot #1-#3, one at a time | Each merged with main CI green |
| 5 | Harel | WhatsApp preview and an Android pass | Screenshots saved to `agent-evidence/` |
| 6 | Agent | Security scan of 19.10 and compatibility of 18.10 on schedule | Both runs present and green |
| 7 | Both | First family-built corners | Sources, location, photo rights checked, imported via the admin route |

Each code change goes through a PR with full CI, automatic staging and the release kit's gates.
