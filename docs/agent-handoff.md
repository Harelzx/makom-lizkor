# Backend continuation record

## חלופת UX מקומית לאישור הראל — 9.10.2026

הענף `codex/ux-experience-preview` נוצר מ־`main` ב־`0d1b7ba`. יושמו המלצות סקירת הממשק, כולל ניווט בנייד, פישוט הטופס, סיכום לפני שליחה, הודעות אמינות, אישור מחיקה, חיפוש אחיד, שמירה לביקור והצעה אחת נוספת. פירוט מלא: [ux-experience-preview.md](ux-experience-preview.md).

בעקבות צפיית הראל בוצע תיקון נוסף באותו ענף: הצעות נשמרות במכשיר רק אחרי אישור קבלה מהשרת; שליחה שנכשלה או סורבה נשארת בזיכרון הטופס בלבד, ללא ניסיון אוטומטי. סגירה מוחקת את הפרטים. תשובה שאבדה משאירה ניסיון ידני עם אותו מזהה ותוכן; אין הבטחה לניסיון חדש אחרי סגירה. עותק של הצעה שנדחתה במודרציה נמחק כשמצבה נלמד דרך המעקב. אישור קבלה מופיע בחלון תודה אישי שאינו נסגר בעצמו. הודעות קצרות ממורכזות בנייד ונמצאות מעל לוח המקומות עם כפתור סגירה נגיש. כל שלושת איורי הטופס נכנסים במלואם למסגרת.

הבדיקות המקומיות העדכניות: 108/108 בדיקות לקוח, 10/10 בדיקות גרסאות הודעת השליחה; בסבב דפדפן רחב 48/52 עברו ונמצאו בעיית פתיחה מחדש ושתי בעיות תצוגה/שכבות של הודעת המחיקה. לאחר התיקונים עברו 22/24 בסבב ממוקד, ושתי האחרונות חשפו חסימת לחצן ההודעה על ידי לוח המקומות. תיקון ההודעה לפורטל נפרד עבר 4/4 על הבילד המקומי, כולל שלושת שלבי האיור, חלון תודה מתמשך ונגישות ב־320, 390 ו־1280 פיקסלים ולחיצה ממשית על סגירה בנייד. הסבבים חופפים ואין לחברם למספר בדיקות ייחודיות. כל מקרי השליחה, התאוששות, מעקב, מייל אופציונלי ותמונה שבסבב הרחב עברו, והזרימות שהושפעו מאיפוס הטופס עברו בסבב הממוקד. typecheck, lint ו־format:check עברו.

הראיות וסרטוני הגרסה המעודכנת נמצאים בתיקיית `agent-evidence/ui-ux-refinements-20261009` שמעל `web`; `test-summary.json`, `delivery-verification.json` ודוח עברי קושרים את התוצאות לקומיט המצולם. הסרטונים משתמשים בתוכן דמה ותשובות מדומות ומסומנים בהתאם. בדיקת מקלדת בטלפון פיזי וצפייה של משתמשים אמיתיים עדיין לא בוצעו. הסרטונים הקודמים ותוצאותיהם נשמרו בתיקיית `ui-ux-implementation-20261009`.

**אין מיזוג, דחיפה או פריסה של החלופה בלי אישור הראל אחרי צפייה.** `main` המקומי, `main` ב־GitHub ואתר הבדיקות אינם חלק מענף החלופה. המעקב הקודם נשאר מושהה; אין להפעיל מחדש בדיקות שחזור, ליצור משאבים או לשנות הרשאות. `RETENTION.verified` ו־`MAILBOX.verified` נשארים false. יתר הרשומה מתארת את הבסיס שכבר הושלם, ואינה ראיה לפריסת החלופה.


Updated 8 October 2026, after the 21:14 UTC UI deployment and live visual readback. Read this after compaction, then the adviser pointer in `CLAUDE.md`. Confirm actual Git state before acting. Older narratives remain in Git history.

## Current UI follow-up — deployed and visually verified

After the backend closeout, Harel reported three add-place layout issues on staging: step indicators too small and grouped away from the progress segments, the active ring crowding its label, and the pin-removal button overlapping the location description. The focused correction in `src/components/add-place.tsx` aligns both rows to the same three-column grid, enlarges the number circles to 28px with a 10px label gap, and places removal in normal flow below the description. Coordinate pairs stay together in LTR on narrow screens.

Local verification: typecheck, targeted ESLint/Prettier and `git diff --check` pass. The existing accessibility test `adding a place, every step` passed (plus its seed dependency, 2/2). Final pixel/layout inspection covered all three steps across six desktop/mobile/light/dark layouts, including 320px width; alignment, ring spacing, no horizontal overflow and pin removal all pass. Actual screenshots and 18 observations are in `../agent-evidence/ui-add-place-20261008/`. This is a UI change, with no backend/authorization/retention changes and no form submitted during the layout inspection.

Application `ac3e99690b29ab9764a4fa45ccc62b82887f78fb` passed CI `37840605669` (all four jobs), then staging `37844652764`. The downloaded same-SHA receipt names `staging-ac3e99690b29` and all nine edge checks pass. The protected site was reloaded in a separate agent tab and inspected at 892×774 and 390×844 without submitting a form: steps sit above their matching segments, the 28px circles have 10px label spacing, and pin removal is below the description without overlap. Screenshots `live-desktop-892-pin.jpg`, `live-phone-390-step1.jpg`, `live-phone-390-pin.jpg`, readback `live-visual-readback.json` and the receipt are under `../agent-evidence/ui-add-place-20261008/`. The user's tab was preserved, the viewport override reset and the agent tab closed. Current status is in `deployment-progress.json`. This UI task is complete; pause its chat monitor. Do not repeat the completed backend backup/recovery exercises.

Harel also requested a comprehensive UI/UX review while CI ran. The read-only review and screenshots are in `../agent-evidence/ui-ux-audit-20261008/ux-review-he.md`. It distinguishes live observations, source findings and product proposals. Recommended focused fixes concern mobile list/story access, the 320px header, truthful submission feedback, explaining local-copy deletion before losing tracking access, and consistent search fields. These recommendations are not implemented or authorization to redesign the site. Other additions are optional after launch. Keep the existing anonymous submission, optional email, consent and safety controls. No new resources, production actions or live messages were performed.

## Current outcome — approved staging technical closeout complete

- All seven backend phases are implemented, reviewed and merged. **Protected synthetic staging is technically closed out. Production is not launched.**
- Verified application commit: `8c5baf09c94284d1fafde67d105497491436759b`, merged and pushed to private GitHub main. CI `37824944595` passed all four jobs. Staging workflow `37829847824` succeeded and all nine edge checks passed for `staging-8c5baf09c942`.
- This completion update changes documentation only. A subsequent documentation-only main commit is not a new tested/deployed application version. No repeated CI or deployment is warranted solely to record these results; any future application/release candidate still needs its own normal checks and same-commit staging receipt.
- Actual deployed Worker version `2ec33872-320f-4311-b928-7ad5e5ec5cd3`, deployment `204ad69c-e733-4e37-892b-c5c602ff07e9`, created 19:10:44 UTC. Readback confirms staging, `EDGE_CACHE=off`, serving DB and separate `DRILL_DB`, and the drill secret binding by name only.
- The one-shot runner PID 38793 has exited. **Do not restart it.** All mutations finished. It stopped only at its final read-only eleven-term UNION query, rejected by Cloudflare with HTTP 400. At 19:20 UTC, the already-established alternative (eleven independent COUNT statements in one batch) succeeded: every target table is empty. The original failed observer log is preserved; the separate final readback closes that observation defect without rerunning recovery or deploying again.
- Harel confirmed Workers Paid on staging and successfully logged in as preview-only `makomlizkor@gmail.com`. No human moderator role was granted. Gmail is the chosen contact address; domain is explicitly deferred. These decisions do not authorize new subscriptions, a production account, production resources, public content or live mail.
- `RETENTION.verified=false` and `MAILBOX.verified=false` remain correct. Staging evidence does not establish provider physical-erasure timing, a production configuration, or real mailbox behavior.

## Verified cloud evidence

All relative evidence paths below are rooted at `../agent-evidence/backend-phase4/`.

| Check | Result and actual evidence |
| --- | --- |
| GitHub CI | All four jobs successful on `8c5baf0`; run `37824944595`. Production panel scenario also passed. |
| Staging and nine checks | Same application commit; run `37829847824`; `staging-8c5baf09c942/receipt.json`. |
| Scheduled application expiry | Pass, real cron `rr_01M4E26P78J3A2R3AQ1APGS126`, 15:30:41–15:30:51 UTC: due content/contact/report/tribute identifiers removed or blanked, totals and not-due controls preserved. `expiry-seed-20261008.json.checked.json`. |
| Actual isolated recovery with media | Pass 17:17:24 UTC; regular export `ex_01M4E86YJ8YDZJSPV4JFQRK5WX`. Import/replay filtered expiry and the post-export withdrawal; one photo restored and hash-checked (554146 bytes, zero missing/damaged). Target emptied and exercise media removed. `cloud-recovery-result-20261008.json` and `reports/cloud-recovery-independent-readback-20261008.json`. |
| Real export/photo pruning | Pass 18:31:21 UTC: old data/manifest/photo absent, young referenced controls remain. Real upload timestamps and two-hour grace preserved. `prune-cloud-20261008.json.checked.json`. |
| Scheduled drill after deployment | `dr_01M4EF2NT86CCNBJRS2HHCE5YJ`, 19:15:41–19:16:49 UTC, `ok=1`, no failure, using new export `ex_01M4EF2NT84B5T03PSN9H5GY03`. |
| Independent final cleanup/settings | 19:20:19 UTC: all eleven export tables empty in the isolated target; serving and drill databases remain distinct. `reports/cloud-closeout-final-readback-20261008.json`. |

Consolidated receipt: `reports/cloud-closeout-final-verification-20261008.json`. Live/current progress: `reports/technical-closeout-progress-20261008.json`. The one-shot's `reports/cloud-continuation-20261008.json` is preserved as its original execution record, including the resolved final observer error.

Reviewed recovery code `62b49ee034f37c3e8af73b220fef72edf92c7805` was accepted by `20261008T164131Z-ea77a406`; `c684733` added documentation only. Recovery operation counters were not reset: 298 SQL, 100 HTTP, 2 photo operations, one cleanup attempt. Independent observation calls are recorded separately.

## Resources and authority

- Account `8f355daed33cf31c238047e6b455ec9a`; Worker `makom-lizkor-staging`; protected preview `https://makom-lizkor-staging.makom-staging.workers.dev`.
- Serving DB `6cebc14f-18b1-41fd-9d21-fd885e71ce25`; EU drill DB `makom-staging-drill`, `8e879921-1f75-4358-a62b-73f8fbcd083a`. Only the drill target was restored/emptied, never the serving database.
- Harel explicitly approved the isolated drill database within existing allowances and the encrypted GitHub test key `STAGING_DRILL_PRIVATE_KEY`; both are provisioned. The owner key stayed local. Do not request the same approvals again.
- No object-lock rules and only the default multipart-abort lifecycle were observed in EU R2. These observations and successful application pruning do not prove provider physical erasure. `reports/provider-before-closeout-20261008.json`.
- Synthetic staging still uses `RETENTION_DAY_SECONDS=7200`, official Turnstile test keys, Access protection and no Worker cache. None is a production setting to copy blindly.

## Next action — owner launch choices, not another backend phase

There is no active closeout test and no pending staging repair. Pause the closeout heartbeat after recording this outcome. Scheduled cloud maintenance continues normally; pausing the chat monitor does not disable it.

`launch-decisions.md` holds the finite next steps:

1. Harel supplies the operator name for publication and the email explicitly authorized for human administration. Gmail contact is already chosen; it is not automatically the administrator.
2. Together select a small initial set of family-created memorial corners, check sources, location/access and photo permissions, then obtain content approval. The 90 development records are not approved launch content.
3. When Harel is ready, choose a domain and approve a concrete production setup within a stated budget. Additional-account creation was blocked by Cloudflare's user-age rule; a one-account alternative has not been adopted. Do not silently repurpose staging or broaden its credentials.
4. Configure and verify production sign-in, contact/mail handling, accurate notices and normal release checks, including real share previews. Staging proof is reused where appropriate; actual production configuration remains to be verified. Do not promise a fixed provider-wide deletion deadline without support.

No purchase, extra resource, public deployment, production data access or live email is authorized by completing these tests. Do not change verification flags to bypass release checks. Do not restart the seven-phase plan, provider migration or synthetic exercises just because older documents list them unchecked.

## Working rules

- Conditional adviser approval is executed once its conditions pass; unchanged evidence/docs need no new approval round. The observer correction required only independent readback.
- Focused checks for corrections; full suites on a materially changed integrated candidate. No new local browser marathon for documentation. Deployment still requires that application's successful CI and the normal release gates.
- Use `scripts/heavy` for heavy commands, one at a time. Exit 75 means light independent work, not a retry loop. Never lower thresholds or bypass the lock.
- Consult before a third distinct unsuccessful fix, or sooner if no evidence-based next step exists. Include expected/observed behavior, attempts, evidence and one question.
- Adviser source failure is a bridge issue: preserve the pinned report, report the exact missing path once, and continue independent work. Never repeatedly compress sources or treat unread files as reviewed.
- A failed post-deploy check means deployed but unverified, not nothing changed. Follow the existing rollback/fix-forward record.

## Earlier local closeout (historical evidence)

Reviewed code is merged into **main at `86efa9070bf532f94f0677473168a43b7e3b3a68`**, now published to GitHub with later documentation commits and CI-tested at `bea9927`. Staging was temporarily disabled for the initial sync, then re-enabled after Harel confirmed the staging Paid upgrade. Workflow definitions and production protections are unchanged. The merge includes a production-runtime mail adapter as well as evidence tools/tests and documents. It was conflict-free and preserved the reviewed candidate `a4a568e`.

1. Integrated `claude/l-ret-checklist`: verified share-page status and the outstanding cloud recovery/provider evidence conditions.
2. Corrected the adviser source reader outside this repository: exact committed `.ts`/`.mjs` files under `tools/l-ret/` are readable in immutable snapshots. Credential-name, traversal, symlink, binary and size restrictions remain. A real capsule exposed every original harness source; 77 bridge tests passed and an independent review found no material defect.
3. Reconciled the original human finish-launch instruction as `HAREL-FINISH-LAUNCH-20261007` in the trusted register. This permits routine local completion and bounded evidence, not purchases, new cloud resources, production actions or unverified public promises. Do not request that same authorization again.
4. Harness corrections on `claude/l-ret-harness`: `7147059`, then `fd51075`. They bind credentials to exact staging targets, reject redirects, validate export counts, fail failed drills/cleanup, and require cohort/report evidence. Missing coverage is incomplete (exit 3), not a pass. Source export and restored reports must exclude abuse identifiers. Fifteen focused Node tests passed; syntax and targeted format checks passed. No cloud experiment was rerun for these changes.
5. Completed the production email adapter (`df8e409`, integrated as `f9fff67`): native Cloudflare `MAIL.send`, configured `MAIL_FROM`, acknowledgement/error handling, and no live sending from synthetic staging. Thirteen focused tests, Worker typecheck and independent review passed. No email was sent; binding, verified sender/domain and actual delivery remain commissioning work.
6. Removed stale phase-1-only descriptions from `CLAUDE.md` and corrected the checklist's already-fixed export cleanup, already-built share images and lazy map loading. Compliance research remains historical; it points here for current status.

Adviser `20261008T044401Z-f0bc46ce` read every harness source and closed `L-RET-HARNESS-EVIDENCE-1`, `CI-INTRO-OBS-1` and `L1`. It accepted the bounded E2 replacement method. It also found `L-RET-HARNESS-ORACLE-1`: expectations must follow ledger erasure reasons and the shortened recovery deadline of open reports. This is an evidence-tool defect, not a demonstrated application recovery defect. Correction `4150c7e` derives expectations from the actual export/ledger and deployment cutoffs; 15 regressions through real D1 import/replay passed, including deliberately corrupting the restored result. Adviser `20261008T050606Z-6b37da3d` subsequently inspected the correction and mail adapter, closed `L-RET-HARNESS-ORACLE-1`, and approved local integration. Both source-availability and oracle findings are now closed. Do not claim the older a113 read the unavailable sources.

## Remaining finding dispositions

- `C-CACHE-TEST-1`: historical isolated failure remains undiagnosed under its accepted conditional-integration disposition; recurrence stops the dependent deployment. Later successful runs do not explain its cause.
- `L2`: approved synthetic cloud expiry, pruning, media recovery and scheduled drill are now complete. Production configuration and truthful provider/retention wording remain open; do not restart the staging exercise.
- `L3`: approved real launch content and production configuration/data transition.
- `L4`: real external share-preview verification, after the real public domain is available; not silently waived.
- `P1`: the production-build frame-rate check passed twice with the original 4x CPU throttle and assertions. The adviser accepted the reported pass but requested run-environment evidence, not another full suite or approval round. That evidence is now captured on merged `86efa907`: `scripts/heavy npm run e2e:prod -- --grep 'keeps the frame rate' --reporter=list,json`, 2/2 including seed, exit 0, 39 seconds including build. Nine samples during the 18.33-second montage test show load 5.12–6.39 on eight cores, mean total CPU busy 50.1% (peak 87.5%, including the test), and minimum macOS memory level 29%. The project heavy lock was held; no other project heavy test was run. These are measured conditions, not a claim of an idle computer or a phone benchmark. Summary, full samples and exact Playwright timings are in `../agent-evidence/backend-phase4/reports/codex-performance-{summary,environment,playwright}-20261008.json`. Include this evidence in the next normal completion report for register reconciliation; no separate approval consultation is required, and do not repeat the same benchmark merely to gather evidence already stored.
- `L-OG-FREE-1`: owner confirmed Workers Paid on staging; no repeat plan decision is required for staging. Production setup remains separate. Cache activation's separate Free-plan finding is outside the chosen no-cache launch path.

Natural-expiry monitoring becomes supplementary after equivalent evidence succeeds. Optional content/visual expansion can follow later. Lawyer consultation and the privacy-authority opinion are recommendations in the existing compliance plan, not newly invented technical gates. Public wording still needs the owner's approval.

A bounded stub scan found production error-rate telemetry is not connected: `/api/ops` honestly reports `errors.status=unavailable`. This is a deferred diagnostics integration, not a broken visitor or moderation flow. Do not claim monitoring is fully connected or invent a new launch subsystem for it.

The locked dependencies were restored in the primary checkout. The audit reported 14 inherited high package entries from two developer-tooling advisories (braces and Sharp); no deployed execution path was identified. The findings are not fixed. Details and constraints: `../agent-evidence/backend-phase4/reports/dependency-audit-triage-20261008.md`. Do not force-downgrade the Cloudflare toolchain to clear audit counts.

## Durable pointers

- Adviser: `/Users/harel/Documents/Codex/2026-10-05/b/outputs/codex-supervisor/CLAUDE-HANDOFF.md`; runtime decisions and trusted approvals live beside it.
- Evidence: `/Users/harel/Desktop/remember_07102026/agent-evidence/backend-phase4/`.
- The old detailed retention observations are in `l-ret-evidence-plan.md` and `a2-snapshots.md` there. The accepted bounded replacement has now passed; current receipts are above. Historical unchecked plans are not new requirements.
- Tool source is committed under `tools/l-ret/`, so it survives loss of Claude's temporary p21 checkout. Do not remove another session's worktree while it may still use it.
- Historic approvals, reports, cohort receipts and raw logs remain preserved. Do not edit old evidence to fit the newer plan.
