# Continuation record: backend session

The backend session's current handoff. Read it after any restart, compaction or recovery, together with the CLAUDE.md section "Delegated adviser while Harel is away" and the bundle's `WORKFLOW-V5.md` and `policy-v5.md` (workflow 5: reports go with `--review-access snapshot`; launch target 7 October 2026). Earlier history is in this file's git history and the bundle's `runtime/`.

## State (2026-10-06, 17:00)

- Worktree: `/Users/harel/Desktop/remember_07102026/web/.claude/worktrees/system-architecture-design-9a660f`, branch `claude/system-architecture-design-9a660f`, fast-forwarded to `main`.
- **Phase 4 is merged locally into `main` at `f8db32a`** (`--no-ff`; tree identical to the reviewed head `3bf6d59`). Nothing pushed or deployed.
- Tested head: `9c4b6b5` (static, dev 87/87, prod 87/87); `8a09f19` notice text only (notice 6/6); `3bf6d59` docs only.
- Durable evidence (outside git, synthetic only): `/Users/harel/Desktop/remember_07102026/agent-evidence/backend-phase4/` — `reports/` (up to `phase4-y.json`, answers up to `a41.json`), `runs/<time>-<label>/`, `stages.sh` (run with `bash`).
- Latest adviser: a41 (`20261006T133047Z-f804ec9a`, proceed): Phase 4 accepted; F4-C1.4 and C1.6 closed; local merge authorized and done.
- Privacy session ("terms_condtion"): notice 10-3 and About approved; it runs its tests on `main` now.

## Flows

| flow                                                                                                                                                                         | state                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Phases 1–3                                                                                                                                                                   | merged locally into `main` at `472ce14` |
| Phase 4 (tasks 1–7: removal requests, suppressions, durable ops and ledger, moderators' side, scheduled job, request form with in-browser recovery; generic share image, L4) | merged into `main` at `f8db32a`         |
| Phases 5–7                                                                                                                                                                   | not started                             |

## Findings (one list, stable IDs)

| id     | what                                                                                                                                                                                                                          | class       | closure                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------- |
| F4-R10 | late writes after a withdrawn place's watch ended leave unserved files                                                                                                                                                        | nonblocking | Phase 5 sweep (L2)                 |
| F4-R12 | intake/replay interruption                                                                                                                                                                                                    | nonblocking | non-final client wording in task 6 |
| P1     | frame-rate check failed last prod measurement (2.19 vs 1.69 long frames/s)                                                                                                                                                    | launch-only | `perf-prod` on a quiet machine     |
| L1     | real edge purge and cache; Workers Caching is off (`cache.enabled` unset): enabling it caches every Worker response, so each response's Cache-Control needs a staging audit; `ctx.cache.purge` checked against CF docs        | launch-only | staging                            |
| L2     | Phase 5: 30-day erase, tribute pruning, provider deletion tail; `sweepPhotos` unscheduled, must cover held/ (keep twins of live keys) and writers in flight (pre-record approval copies, uploads, obsolete keys, late writes) | launch-only | Phase 5                            |
| L3     | curated demo data out of the Worker                                                                                                                                                                                           | launch-only | Phase 7                            |

Closed: F4-C1 whole (C1.1–C1.6, a36–a41); E4-1 (dev 87/87, prod 87/87 on 138e3e9, again on 9c4b6b5); F4-C1.2, C1.3 (a40); F4-C1.5 (a39); F4-C2 (a37); F4-A, A1–A6 (7957f9c9 and earlier); F4-B (a34, cfa3167); F4-O1–O4 (a27–a29); F4-R1–R9, R11; B1–B4, R1, N1, N2, N6. Notice wording (25 h, backup tail) is a draft, not an approved public claim.

## Coverage (accepted packets)

Intake/policy and moderation (F4-A, incl. pinned moderation/reports/recovery tests); admin paging UI (pager); engine and ledger (ops.ts, ledger.ts, purge.ts, 0009–0013); media lifecycle (photos.ts, placePhoto, the photo watch, withdrawal erasure, durable cleanup, refusal/preparation boundary); serving gates and projection (places.ts, index.ts, media-gate, share 410); replay targets (manual and automatic); transitions. Whole-phase fresh review: F4-R1..R12 (3a422d2..014686b).

## Tests (latest)

| command                             | commit    | result                                                                                                                                                               |
| ----------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash stages.sh static dev prod`    | `9c4b6b5` | static clean, dev 87/87, prod 87/87 (`runs/20261006T160006-9c4b6b5/summary.tsv`); scripts 10/10 on `138e3e9` (unchanged since); the frame-rate check is P1, separate |
| `scripts/heavy npm test` (Worker)   | `9c4b6b5` | 305/305; notice test 6/6 again on `8a09f19`                                                                                                                          |
| `scripts/heavy npm run test:client` | `9c4b6b5` | 90/90                                                                                                                                                                |

Red checks where a test's sensitivity was in doubt (logs in `runs/*-c1*-mutations`).

## Independent choices since the restart

- held/ keeps a copy while a photo is published (no move deletes it); a standing photo watch (`media_checks`) re-checks moved photos hourly (target cadence) and erases withdrawn places' files.
- Purge tries reserved in SQL; fairness by `updated_at`; refusal cleanup derived from the stored row.
- Ledger entries carry suppression `targets`; photo lifecycle moved to `worker/db/photos.ts`.
- Workers Caching left off until staging (L1).

## Next action

Release checklist (owners, missing evidence; local code vs real-environment checks vs Harel's decisions). Then Phase 5 (retention, backup and recovery: 30-day erase, tribute pruning, sweep incl. held/ and writers in flight (L2/F4-R10), export, Route A rule), with its own short plan and finite checks.

## Pending for Harel (not development)

Domain, mailbox, operator identity, real Turnstile/Email/R2, staging account, legal sign-off of the notices.
