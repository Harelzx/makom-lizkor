# Continuation record: backend session

The backend session's current handoff. Read it after any restart, compaction or recovery, together with the CLAUDE.md section "Delegated adviser while Harel is away", the bundle's `CLAUDE-HANDOFF.md` and `policy.md` (workflow revision 4.1), and `SECOND-AUDIT-CHECKPOINT-AND-RESUME.txt` section B. Earlier history is in this file's git history and the bundle's `runtime/`.

## State (2026-10-06 afternoon, after the restart)

- Worktree: `/Users/harel/Desktop/remember_07102026/web/.claude/worktrees/system-architecture-design-9a660f`, branch `claude/system-architecture-design-9a660f`. Code head `cfa3167`; `main` = `7939b5f`. Nothing pushed or deployed.
- Durable evidence (outside git, synthetic only): `/Users/harel/Desktop/remember_07102026/agent-evidence/backend-phase4/` — `reports/` (reports `phase4-*.json` up to `phase4-s.json`, questions `q*.txt` up to `q35`, answers `a*.json` up to `a34.json`), `runs/<time>-<label>/` (logs, red/green, mutation logs), `stages.sh` (stage runner; ROOT = `runs/`). The session scratchpad does not survive a restart.
- Latest adviser: `a34.json` (proceed): F4-B closed at `cfa3167`. Phase completion and local merge not yet approved.

## Flows

| flow                                                                                                                                                           | state                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Phases 1–3                                                                                                                                                     | merged locally into `main` at `472ce14` |
| Phase 4 tasks 1–5 (durable ops and ledger, removal requests, suppressions and the moderators' side, scheduled job) with all review corrections                 | on the branch, source accepted          |
| Phase 4 task 6: request form in the place card (privacy session's three result texts verbatim, notice 10-2), hidden-name display, quiet close of a hidden card | **next**                                |
| Phase 4 task 7: per-place share image decision                                                                                                                 | not started                             |
| Phase 4 checkpoint: full dev/prod functional e2e (E4-1), final report, local `--no-ff` merge, `scripts/milestone`, tell the privacy session                    | not started                             |
| Phases 5–7                                                                                                                                                     | not started                             |

## Findings (one list, stable IDs)

| id     | what                                                                                                                                                                                                                          | class          | closure                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------- |
| E4-1   | full dev/prod e2e: one test past its 30 s budget per run at load 11–12; isolated reruns pass                                                                                                                                  | merge-blocking | passing full dev and prod functional suites at the checkpoint |
| F4-R10 | late writes after a withdrawn place's watch ended leave unserved files                                                                                                                                                        | nonblocking    | Phase 5 sweep (L2)                                            |
| F4-R12 | intake/replay interruption                                                                                                                                                                                                    | nonblocking    | non-final client wording in task 6                            |
| P1     | frame-rate check failed last prod measurement (2.19 vs 1.69 long frames/s)                                                                                                                                                    | launch-only    | `perf-prod` on a quiet machine                                |
| L1     | real edge purge and cache; Workers Caching is off (`cache.enabled` unset): enabling it caches every Worker response, so each response's Cache-Control needs a staging audit; `ctx.cache.purge` checked against CF docs        | launch-only    | staging                                                       |
| L2     | Phase 5: 30-day erase, tribute pruning, provider deletion tail; `sweepPhotos` unscheduled, must cover held/ (keep twins of live keys) and writers in flight (pre-record approval copies, uploads, obsolete keys, late writes) | launch-only    | Phase 5                                                       |
| L3     | curated demo data out of the Worker                                                                                                                                                                                           | launch-only    | Phase 7                                                       |

Closed: F4-A, A1–A6 (7957f9c9 and earlier); F4-B (a34, cfa3167); F4-O1–O4 (a27–a29); F4-R1–R9, R11; B1–B4, R1, N1, N2, N6. Notice wording (25 h, backup tail) is a draft, not an approved public claim.

## Coverage (accepted packets)

Intake/policy and moderation (F4-A, incl. pinned moderation/reports/recovery tests); admin paging UI (pager); engine and ledger (ops.ts, ledger.ts, purge.ts, 0009–0013); media lifecycle (photos.ts, placePhoto, the photo watch, withdrawal erasure, durable cleanup, refusal/preparation boundary); serving gates and projection (places.ts, index.ts, media-gate, share 410); replay targets (manual and automatic); transitions. Whole-phase fresh review: F4-R1..R12 (3a422d2..014686b).

## Tests (latest)

| command                                                 | commit    | result                                   |
| ------------------------------------------------------- | --------- | ---------------------------------------- |
| `scripts/heavy npm test` (Worker)                       | `cfa3167` | 304/304 (`runs/*-p6a-red/worker.log`)    |
| `scripts/heavy npm run test:client`                     | `71d0f91` | 50/50 (no client change since)           |
| `scripts/heavy npx playwright test e2e/reports.spec.ts` | `71d0f91` | 3/3                                      |
| full stages (dev/prod e2e)                              | `22d7872` | dev 70/71, prod 70/71 (E4-1), historical |

Each fix since the restart was red first and mutation-checked (logs in `runs/`).

## Independent choices since the restart

- held/ keeps a copy while a photo is published (no move deletes it); a standing photo watch (`media_checks`) re-checks moved photos hourly (target cadence) and erases withdrawn places' files.
- Purge tries reserved in SQL; fairness by `updated_at`; refusal cleanup derived from the stored row.
- Ledger entries carry suppression `targets`; photo lifecycle moved to `worker/db/photos.ts`.
- Workers Caching left off until staging (L1).

## Next action

Task 6 (client request form), then task 7 (OG decision with the adviser), then the Phase 4 checkpoint (measure load; full functional dev/prod e2e through `stages.sh dev prod`; final report; merge).

## Pending for Harel (not development)

Domain, mailbox, operator identity, real Turnstile/Email/R2, staging account, legal sign-off of the notices.
