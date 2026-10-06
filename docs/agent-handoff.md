# Continuation record: backend session

The backend session's current handoff. Read it after any restart, compaction or recovery, together with the CLAUDE.md section "Delegated adviser while Harel is away" and the bundle's `WORKFLOW-V5.md` and `policy-v5.md` (workflow 5: reports go with `--review-access snapshot`; launch target 7 October 2026). Earlier history is in this file's git history and the bundle's `runtime/`.

## State (2026-10-06, 15:10)

- Worktree: `/Users/harel/Desktop/remember_07102026/web/.claude/worktrees/system-architecture-design-9a660f`, branch `claude/system-architecture-design-9a660f`. Code head `9f7e7b9`; `main` = `7939b5f`. Nothing pushed or deployed.
- Durable evidence (outside git, synthetic only): `/Users/harel/Desktop/remember_07102026/agent-evidence/backend-phase4/` — `reports/` (reports up to `phase4-v.json`, answers up to `a38.json`), `runs/<time>-<label>/`, `stages.sh` (stage runner).
- Latest adviser: a38 (`20261006T114631Z-b8012220`, revise, snapshot mode): F4-C1.2–.5 → fixed in `9f7e7b9`, report to send. F4-C2 closed (a37).
- Privacy session ("terms_condtion"): approved notice 10-3 wording (applied in eb5caab); the failed-removal sentences changed in 9f7e7b9 were sent to it for confirmation.

## Flows

| flow                                                                                                                                           | state                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Phases 1–3                                                                                                                                     | merged locally into `main` at `472ce14`                    |
| Phase 4 tasks 1–5 (durable ops and ledger, removal requests, suppressions and the moderators' side, scheduled job) with all review corrections | on the branch, source accepted                             |
| Phase 4 task 6 and its corrections (F4-C1: kept requests in a page registry and IndexedDB, 24 h, hidden-place entry; F4-C2)                    | done, adviser review of `9f7e7b9` pending                  |
| Phase 4 task 7: per-place share image decision                                                                                                 | generic OG accepted locally (L4); deferral is Harel's call |
| Phase 4 checkpoint: full dev/prod functional e2e (E4-1), final report, local `--no-ff` merge, `scripts/milestone`, tell the privacy session    | not started                                                |
| Phases 5–7                                                                                                                                     | not started                                                |

## Findings (one list, stable IDs)

| id     | what                                                                                                                                                                                                                          | class          | closure                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------- |
| F4-C1  | report recovery lifecycle (a36–a38)                                                                                                                                                                                           | merge-blocking | review of `9f7e7b9` (registry, deadline, cleanup, unread store) |
| E4-1   | full dev/prod e2e: one test past its 30 s budget per run at load 11–12; isolated reruns pass                                                                                                                                  | merge-blocking | passing full dev and prod functional suites at the checkpoint   |
| F4-R10 | late writes after a withdrawn place's watch ended leave unserved files                                                                                                                                                        | nonblocking    | Phase 5 sweep (L2)                                              |
| F4-R12 | intake/replay interruption                                                                                                                                                                                                    | nonblocking    | non-final client wording in task 6                              |
| P1     | frame-rate check failed last prod measurement (2.19 vs 1.69 long frames/s)                                                                                                                                                    | launch-only    | `perf-prod` on a quiet machine                                  |
| L1     | real edge purge and cache; Workers Caching is off (`cache.enabled` unset): enabling it caches every Worker response, so each response's Cache-Control needs a staging audit; `ctx.cache.purge` checked against CF docs        | launch-only    | staging                                                         |
| L2     | Phase 5: 30-day erase, tribute pruning, provider deletion tail; `sweepPhotos` unscheduled, must cover held/ (keep twins of live keys) and writers in flight (pre-record approval copies, uploads, obsolete keys, late writes) | launch-only    | Phase 5                                                         |
| L3     | curated demo data out of the Worker                                                                                                                                                                                           | launch-only    | Phase 7                                                         |

Closed: F4-C2 (a37); F4-A, A1–A6 (7957f9c9 and earlier); F4-B (a34, cfa3167); F4-O1–O4 (a27–a29); F4-R1–R9, R11; B1–B4, R1, N1, N2, N6. Notice wording (25 h, backup tail) is a draft, not an approved public claim.

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

Send the corrective report for c64fed1..9f7e7b9 (snapshot mode). If accepted: Phase 4 checkpoint (load check; full functional dev/prod e2e via `stages.sh dev prod`; final report; local `--no-ff` merge; `scripts/milestone`; tell the privacy session). Then Phases 5–7 and the release checklist.

## Pending for Harel (not development)

Domain, mailbox, operator identity, real Turnstile/Email/R2, staging account, legal sign-off of the notices.
