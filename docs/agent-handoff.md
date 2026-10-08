# Backend continuation record

Updated 8 October 2026. This is the current record; older narratives remain in Git history. Read this after compaction, then the adviser pointer in `CLAUDE.md`. Confirm actual Git state before acting. Do not turn historical plans or old unchecked recommendations into new launch requirements.

## State and evidence

- All seven backend phases are implemented, reviewed and merged into `main`.
- Last deployed and fully CI-tested application: `00879198ada9017f0d5a33d5d26b3374484690d8`.
- CI `37703602135` passed. Protected staging deploy `37706759867` passed all nine edge checks: responses, headers, private_no_store, place_page, private_isolation, purge_freshness, no_shared_hit, workers_dev_closed and deployed_version.
- Receipt: `../agent-evidence/backend-phase4/staging-00879198ada9/receipt.json`. Page, feed, share image and photo disappeared 5.3–5.7 seconds after dispatching the synthetic hide; the test restored its fixture afterwards. All 49 sampled Worker answers lacked `CF-Cache-Status`; all 38 version samples matched.
- Earlier complete synthetic submit → approve → publish → hide flow: `cc412c7`, `../agent-evidence/backend-phase4/staging-flow-cc412c718a6f-20261007T174217Z.json`.
- Launch mode is **no Worker cache**, implemented and verified. Do not reopen the superseded cache-enablement/purge design. Production still needs its release checks.
- On 8 October the connected Cloudflare plugin was read-only verified against account `8f355daed33cf31c238047e6b455ec9a`: Worker `makom-lizkor-staging`, D1 `makom-staging`, and the three EU R2 bindings. Staging settings still have `EDGE_CACHE=off`, `RETENTION_DAY_SECONDS=7200`, and no `DRILL_DB`. Billing lookup failed; no paid subscription is confirmed. No production Worker was listed in the accessible account.
- **Production is not set up or launched.** Harel has not chosen domain, public operator name, contact mailbox or moderator email. Keep their placeholders and verification flags; collect these once via `docs/launch-decisions.md`.

## Local closeout (8 October)

Working branch: `codex/launch-closeout-20261008`; resolve its exact head from Git. These changes affect evidence tools and documents, not deployed application behavior.

1. Integrated `claude/l-ret-checklist`: verified share-page status and the outstanding cloud recovery/provider evidence conditions.
2. Corrected the adviser source reader outside this repository: exact committed `.ts`/`.mjs` files under `tools/l-ret/` are readable in immutable snapshots. Credential-name, traversal, symlink, binary and size restrictions remain. A real capsule exposed every original harness source; 77 bridge tests passed and an independent review found no material defect.
3. Reconciled the original human finish-launch instruction as `HAREL-FINISH-LAUNCH-20261007` in the trusted register. This permits routine local completion and bounded evidence, not purchases, new cloud resources, production actions or unverified public promises. Do not request that same authorization again.
4. Harness corrections on `claude/l-ret-harness`: `7147059`, then `fd51075`. They bind credentials to exact staging targets, reject redirects, validate export counts, fail failed drills/cleanup, and require cohort/report evidence. Missing coverage is incomplete (exit 3), not a pass. Source export and restored reports must exclude abuse identifiers. Fifteen focused Node tests passed; syntax and targeted format checks passed. No cloud experiment was rerun for these changes.
5. Removed stale phase-1-only descriptions from `CLAUDE.md` and corrected the checklist's already-fixed export cleanup, already-built share images and lazy map loading. Compliance research remains historical; it points here for current status.

The original tools were held by adviser a113 (`20261008T000013Z-3484dffd`) solely because source was unavailable. Source availability is repaired; acceptance must refer to the corrected pinned snapshot, not claim that a113 reviewed these files. Record the next actual adviser result below after it returns.

## The remaining launch work — finite scope

| Item                                         | Evidence already available                                                                    | Remaining step                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Visitor, moderator and private-data behavior | Complete CI plus successful protected staging flow and all nine edge checks                   | Real production configuration and release checks; no new phase implementation                                                |
| Deletion and export pruning                  | Controlled-clock Worker tests; real export decrypted/checksummed; abuse-code cleanup observed | One bounded scheduled-expiry/export/photo-prune exercise below, with adequate runtime allowance                              |
| Recovery                                     | Existing import/replay/media tests; local rehearsal using a real encrypted export             | One isolated cloud recovery/drill commissioning exercise, including real media recovery and cleanup                          |
| Retention wording                            | Actual code timeline and provider-document investigation                                      | Read back production configuration; approve truthful backup-recoverability wording if physical-erasure timing is unsupported |
| Identity, mail, content and hosting          | Implemented config/release checks; initial content candidates prepared                        | Harel's one consolidated set of choices in `launch-decisions.md`, then configuration and verification                        |

`RETENTION.verified=false` and `MAILBOX.verified=false` remain correct. No purchased plan or production change is authorized. Measured cron CPU of 15–33 ms exceeds the cited Free allowance; do not continue Free-dependent cloud commissioning just because a previous run succeeded. Read-only inspection and local work continue.

## Bounded retention evidence proposal

This corrects the old evidence plan's contradiction: it called natural expiry background but required the same 70-hour wait before closure. The procedure below is prepared for one focused review; it has **not** run and is not a verified result. Existing source/clock tests are reused.

1. Pin the candidate, exact staging resources, real time/scale and a unique synthetic cohort. Use existing submit/moderate APIs, then narrowly seed application-owned expiry fields on only those new synthetic IDs, with marker/status/revision preconditions. Keep due and not-due controls. Let the actual scheduled Worker run; correlate completed `retention_runs`, counts, tombstones/blanked fields, ledger/media effects and surviving controls. Do not manually erase the rows instead of exercising the job.
2. Let the next regular encrypted export run. Under the current scale this is up to roughly two hours plus scheduling delay, parallel with other work. Verify its successful linked retention run, decrypt with the existing harness, and assert expired content absent and controls present. Do not alter successful export history to force a run.
3. Exercise real R2 pruning with isolated synthetic old/young export IDs and valid objects/manifests. Application export age comes from the ULID, so seeded ages must be recorded as synthetic. These fixtures must not become the newest good operational backup or suppress export cadence. Observe removal of old objects and `deleted_at`, with young controls intact. Preserve actual R2 upload timestamps. This does not prove provider lock expiration or physical erasure.
4. Photo orphan grace uses actual R2 upload time. Use an exclusively synthetic already-aged object, with references accounted for, or wait the actual two-hour staging grace plus a cron interval while other work proceeds. Prove the old unreferenced copy is removed while referenced and too-young controls survive. Never forge provider timestamps.

Before executing: the chosen account must have adequate authorized runtime allowance; exact synthetic fixture mutations must be reviewed and within the staging grant. No new database or general test-clock endpoint is implied. Keep the original natural-expiry cohort as supplementary evidence, separate from this replacement, once accepted. Each required outcome must pass; elapsed time, invocation-level success or absent coverage is not success.

**Cloud recovery:** once its isolated target is authorized, run application import/replay and actual media restoration, verify expiry/withdrawal filtering and media hashes, run the configured drill, then verify target cleanup. Never overwrite serving data. The local rehearsal and `runDrill`'s photo-byte checks alone do not prove this.

**Provider promise:** read back actual locks, lifecycle and D1 recovery windows. Distinguish our ability to restore from our backups from provider physical erasure. The prepared wording decision is in `launch-decisions.md`; do not change published notice versions or set verification flags without the corresponding evidence and owner decision.

## Next action and working rules

- Finish one snapshot review of the corrected harness and this finite evidence proposal; reuse accepted unchanged application coverage. Merge reviewed local tools/docs together. Do not push a change that automatically deploys until the applicable runtime/authorization conditions are satisfied.
- Continue with the above finite cloud commissioning and production setup after the consolidated owner choices. Do not start another seven-phase plan or a provider migration.
- Focused tests during corrections. Full suites once on the integrated application candidate; repeat only for material changes or a diagnosed failure. Tools/docs alone do not warrant another local browser marathon. Every main push still triggers CI, and deployment still requires that commit's CI.
- Use `scripts/heavy` for heavy commands, one at a time; exit 75 means do independent light work, not a retry loop.
- Consult before a third distinct unsuccessful fix, or sooner when no evidence-based next step exists. Include expected/observed behavior, attempts, evidence and one question. Conditional approval is executed once its conditions pass; do not ask again just to record success.
- Adviser source failure is a bridge issue: preserve the pinned report, report the exact missing path once, and continue independent work. Never compress source excerpts repeatedly or treat unread files as reviewed.
- A release's failed post-deploy check means deployed but unverified, not "nothing changed". Follow the existing rollback/fix-forward record.

## Deliberately outside the critical path

Natural-expiry monitoring after equivalent evidence; quiet-machine frame-rate measurements; external share-preview checks once a public domain exists; optional content/visual expansion. Lawyer consultation and the privacy-authority opinion are recommendations in the existing compliance plan, not newly invented technical gates. Public wording still needs the owner's approval.

## Durable pointers

- Adviser: `/Users/harel/Documents/Codex/2026-10-05/b/outputs/codex-supervisor/CLAUDE-HANDOFF.md`; runtime decisions and trusted approvals live beside it.
- Evidence: `/Users/harel/Desktop/remember_07102026/agent-evidence/backend-phase4/`.
- The old detailed retention observations are in `l-ret-evidence-plan.md` and `a2-snapshots.md` there. The proposed bounded replacement is above; do not confuse it with executed results.
- Tool source is committed under `tools/l-ret/`, so it survives loss of Claude's temporary p21 checkout. Do not remove another session's worktree while it may still use it.
- Historic approvals, reports, cohort receipts and raw logs remain preserved. Do not edit old evidence to fit the newer plan.
