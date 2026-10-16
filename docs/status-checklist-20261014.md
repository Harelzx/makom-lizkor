# Status checklist - 14 October 2026

A single view of what is done, what is open and who can close it. Built from Git, GitHub (PRs, runs, annotations), `src/config.ts`, `wrangler.jsonc`, `agent-handoff.md` and `checklist-closeout-20261013.md`, and checked against the live site. `go-live-checklist.md` and `launch-decisions.md` are historical planning (both carry banners saying so): their unchecked boxes are **not** reopened here.

## Where we are (15.10, 08:00 UTC)

- Production: release `1455ca7` (version `dd125c74`, tag `release-1455ca79ec2b`), 100% since 07:56 UTC on 15.10, schema 23. It adds to 467730c the map marker fixes (PR #42) and the development-tool bumps (PR #38). Evidence: `agent-evidence/release-mobile-20261015/`.
- Main equals production.
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
- [x] **Release 2bc0ad8 (14.10, 15:38 UTC).** Same-SHA CI, staging and regression; one deploy attempt; no pending migration; Access compared in full before and after for the first time (apps, app and policies identical; 14 anonymous paths unchanged); 25 live checks including Nova's new preview words. The Access after-snapshot's probe timed out twice right after the deploy (20 s); every path answered in under 0.5 s by hand and the third take passed.
- [x] **Shared place previews are about three lines (PR #19).** As many whole sentences as fit in 120 characters, or whole words and an ellipsis; 200 characters had filled WhatsApp's card and ended mid-word. Owner checked Nova's link in WhatsApp on iPhone, 14.10 (`release-share-20261014/whatsapp-preview-owner-iphone.png`).
- [x] **Access API comparison works (14.10).** A read-only token in the owner's Keychain (`makom-production-access-read`) with `Access: Apps and Policies Read` and the separate `Access: Policies Read`; without the second, policies answer 1010. Wrangler's login still can't read Access and is only the fallback.
- [x] **Owner key backup** off this computer, in Apple Passwords with iCloud sync; owner confirmed it opens on the iPhone (14.10).
- [x] **Dependabot #1-#3 and #8 merged** (setup-node 7, upload-artifact 7, download-artifact 8, maplibre-gl 6.13); main CI, staging and regression green. Dependabot stays weekly (owner, 14.10).
- [x] **Release 1455ca7 (15.10, 07:56 UTC).** Same-SHA CI 38697929825, staging 38699843713, regression 38699843666; no migration; one deploy attempt (the first run of the kit stopped at install, before any production step, because another project's simulation held the machine); Access identical before and after; 26 live checks plus the marker CSS and the placement code in the served chunks. On the live site at 402 px, all 22 community dots sit on their points (0 px) and 21 names are placed. Rollback: redeploy `617fcaae`.
- [x] **Community dots on their own points (PR #42).** The marker centered dot and name together, so each dot sat east of its community by half its name (19-29 px: about 3 km at the envelope overview, on desktop too). Names now take a free side of their dot (west, east, below, above); among flowers they stay west over them on their halo; hidden only when other names leave no room. Bilingual photo credits keep each spelling in its own direction.
- [x] **Release 467730c (14.10, 19:42 UTC).** Same-SHA CI 38622086043, staging 38624805924 (attempt 2: the first stopped on a network `fetch failed` in `purge_freshness`) and regression 38624806001; Time Travel bookmark of DB before the change (`00000189-00000000-00005104-7aebb71c2112bd7779e51e9015669af9`); 0023 applied to DB and DRILL_DB, nothing pending after; one deploy attempt; Access apps, policies and 14 anonymous paths identical before and after; 26 live checks. Rollback: redeploy `c7103280` (0023 only adds a table the old code ignores).
- [x] **Errors reach the owner (PR #22).** Every 5xx, every failed job part and browser errors (`client-error` reports, at most 3 per page) are counted unsampled; the daily job mails the moderators at most every 6 hours, browser errors from 3 in 6 hours.
- [x] **Security hardening (PR #23).** Cloudflare tokens only on CI steps that call wrangler (enforced by `ci-policy.mjs`); JPEG metadata stripped through every scan, APP0 kept only as JFIF; Access tokens must carry `exp` and `iat`; same-origin check on the admin's contact route; email links from `PUBLIC_ORIGIN`.
- [x] **Abuse caps (PRs #24, #29).** Removal requests 5 a day per sender, submissions 10 a day per sender (migration 0023, rows pruned after 48 h); both refused with 429 `daily_limit` and a Hebrew message.
- [x] **Deletion on request (PR #26).** The admin can erase a place's content (ledgered, a restore does not bring it back) and purge a removal request's details; the body hash is purged with its text, in the job and on restore. Procedure in `operations-runbook.md`.
- [x] **Privacy texts match the code (PR #25), contact form audited (PR #28).** The contact form has its notice and a «פרטיות» link; it passes the automated audit and the keyboard check.
- [x] **Actions pinned to commit SHAs, Dependabot cooldown 7 days (PR #27).**
- [x] **Production releases by the agent:** a narrow rule in the untracked `web/.claude/settings.local.json` (owner-approved 14.10) lets a session write release kits under `agent-evidence/release-*` and run their `release.sh`. Every gate stays in the kit: same-SHA CI/staging/regression, main unmoved, no runtime drift or secrets in the package, the expected migration only (bookmark first), one deploy attempt, Access probe before/after, live checks.

## Open - Harel only

- [ ] **iPhone Safari** (the iOS simulator on this Mac cannot render any page, 15.10, so only a real iPhone can answer): do the top/bottom edges match the map and sheet (no dark frame)? Does the folded sheet read as draggable? Both were rejected on c937da2; the fix live since 799119e is unproven on a real device.
- [ ] **iPhone at 200% text size:** add-a-place keeps all fields while picking a point.
- [ ] **Android phone** pass (map, list, add place, GPS).
- [ ] **Domain**: deliberately deferred. Decide only when ready; it triggers share-preview and mail checks again.
- [ ] **Two local drafts** in the owner's browser: keep or clear (not in the public feed).

## Open - agent

- [ ] **Weekly security scan** on its own schedule (Mondays 07:17 UTC): confirm the run of 19.10. A manual run on 26.04 passed on 14.10.
- [ ] **TypeScript 7** is held in `dependabot.yml` until typescript-eslint supports it (typescript-eslint#12518); lift the ignore then.
- [ ] **CI token is broader than needed.** The owner pasted its 26 permissions on 14.10 (Zero Trust, DNS, Zone and many unused services among them); staging needs only Workers Scripts, D1, Account Settings and User Details. Replace it with a narrow token when the owner chooses (deferred by the owner, 14.10).
- [ ] **`launch/tiles-check/`** (6 screenshots, 14.10 10:38): keep as tiles-release evidence or delete.

## Open - external professionals (not started, no purchase approved)

- [ ] Legal review: database classification, transfer abroad, consumer Gmail contract basis, 24-month audit retention. Package listed in `checklist-closeout-20261013.md`.
- [ ] Manual screen reader pass (VoiceOver, NVDA) on all flows. The accessibility statement stays "partial" until then.
- [ ] External security review. Current reviews are by agents only.

## Known and deferred (not blockers)

- Error rates in `/api/ops` are sampled (1 in 32 requests); failures themselves are counted unsampled (above).
- 14 high audit entries in developer tooling (braces, Sharp); no deployed path. Do not force-downgrade the Cloudflare toolchain.
- `C-CACHE-TEST-1` historical failure, undiagnosed; recurrence stops the dependent deploy.
- No field Core Web Vitals; lab only (LCP 1.2 s, CLS 0.009).
- Without a map the sunrise is instant (both light shifts return at once); acceptable, noted in review.
- Content growth: family-built corners, outreach to communities and partners (historical lists in `go-live-checklist.md`).

## Next actions, in order

| # | Who | Action | Done when |
|---|-----|--------|-----------|
| 1 | Harel | iPhone Safari: edges, sheet, 200% text | Screenshot accepted, or a concrete fix request |
| 2 | Harel | Android pass | Screenshots saved to `agent-evidence/` |
| 3 | Agent | Security scan of 19.10 and compatibility of 18.10 on schedule | Both runs present and green |
| 4 | Both | First family-built corners | Sources, location, photo rights checked, imported via the admin route |

Each code change goes through a PR with full CI, automatic staging and the release kit's gates.
