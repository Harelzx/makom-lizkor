# Continuation record: backend session

The backend session's current handoff. Read it after any restart, compaction or recovery, together with the CLAUDE.md section "Delegated adviser while Harel is away" and the bundle's `WORKFLOW-V5.md` and `policy-v5.md` (workflow 5: reports go with `--review-access snapshot`; launch target 7 October 2026). Earlier history is in this file's git history and the bundle's `runtime/`.

## State (2026-10-06, 20:15)

- Worktree: `/Users/harel/Desktop/remember_07102026/web/.claude/worktrees/system-architecture-design-9a660f`, branch `claude/system-architecture-design-9a660f`. Phase 4 merged locally into `main` at `f8db32a` (a41); privacy session's docs merged after it (`22f268b`); branch merged `main` at `4f604de`.
- Phase 5 in progress (plan `docs/superpowers/plans/2026-10-06-backend-phase-5.md`): tasks 1–2 reviewed at `90a8a50` (a42 `20261006T135508Z-8ed717b9`: revise); its corrections at code head `52e649d` (`c028443`, `52e649d`), corrective report next. Nothing pushed or deployed.
- Durable evidence: Phase 4 in `/Users/harel/Desktop/remember_07102026/agent-evidence/backend-phase4/`; Phase 5 runs in `…/agent-evidence/backend-phase5/runs/`; reports and answers stay in `backend-phase4/reports/` (up to `phase4-y.json`/`a41.json`, Phase 5 from `phase5-a.json`).
- Privacy session ("terms_condtion"): checks each retention rule as built (commit, rule, test) and alone edits `PENDING_PROMISES` and `RETENTION.verified`. Items 1–2 confirmed against the notices at `52e649d` (contact closure rule, decision-note rule, 10-12 wording incl. the emailed link); it removes their `PENDING_PROMISES` entries when Phase 5 merges.

## Flows

| flow                                                                                                                                                                         | state                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Phases 1–3                                                                                                                                                                   | merged locally into `main` at `472ce14` |
| Phase 4 (tasks 1–7: removal requests, suppressions, durable ops and ledger, moderators' side, scheduled job, request form with in-browser recovery; generic share image, L4) | merged into `main` at `f8db32a`         |
| Phase 5 tasks 1–2 (retention job: abandoned submissions, purge dates, run record, stall alert; scheduled photo sweep; notice 10-12)                                          | a42 corrections at `52e649d`, report    |
| Phase 5 tasks 3–5, Phases 6–7                                                                                                                                                | not started                             |

## Findings (one list, stable IDs)

| id     | what                                                                                                                                                                                                                   | class       | closure                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| F4-R10 | late writes after a withdrawn place's watch ended leave unserved files                                                                                                                                                 | nonblocking | fixed in `ce7e2dd` (scheduled sweep), with the Phase 5 review                                                                                    |
| F4-R12 | intake/replay interruption                                                                                                                                                                                             | nonblocking | non-final client wording in task 6                                                                                                               |
| P1     | frame-rate check failed last prod measurement (2.19 vs 1.69 long frames/s)                                                                                                                                             | launch-only | `perf-prod` on a quiet machine                                                                                                                   |
| L1     | real edge purge and cache; Workers Caching is off (`cache.enabled` unset): enabling it caches every Worker response, so each response's Cache-Control needs a staging audit; `ctx.cache.purge` checked against CF docs | launch-only | staging                                                                                                                                          |
| F5-R1  | erased tombstones and expired returned corrections took uploads by device link                                                                                                                                         | blocking    | fixed `c028443` (barrier in the recording statement; expired returned → superseded); tests: paused upload, 409                                   |
| F5-R2  | after an expired correction, no draft and revise() inherited blank kind/point                                                                                                                                          | blocking    | fixed `c028443` (draft falls back to published; inherit from newest non-blank; n from MAX); test: re-correct, approve, feed                      |
| F5-R3  | contact and decision-note deadlines not set from closure                                                                                                                                                               | blocking    | fixed `c028443`, `52e649d` (contact MIN(purge_after, decision + 90 d); note at decided_at + 90 d once closed, 12 months always); real-flow tests |
| F5-N1  | 10-12 overstated the emailed tracking link                                                                                                                                                                             | blocking    | fixed `c028443` (privacy session's wording, plus the emailed link's lifetime); notice test                                                       |
| E5-1   | no suppression-note fixtures                                                                                                                                                                                           | evidence    | added `c028443` (due/not due, active/lifted)                                                                                                     |
| L2     | Phase 5 remainder: tribute and audit pruning (task 4), provider deletion tail (staging). Done in tasks 1–2: 30-day erase, purge dates, scheduled sweep covering held/ twins and writers in flight                      | launch-only | Phase 5 task 4; tail in staging                                                                                                                  |
| L3     | curated demo data out of the Worker                                                                                                                                                                                    | launch-only | Phase 7                                                                                                                                          |
| L4     | per-place share images: the share page uses the generic image (Phase 4); a per-place image is a product decision                                                                                                       | launch-only | Harel's decision                                                                                                                                 |

Closed: F4-C1 whole (C1.1–C1.6, a36–a41); E4-1 (dev 87/87, prod 87/87 on 138e3e9, again on 9c4b6b5); F4-C1.2, C1.3 (a40); F4-C1.5 (a39); F4-C2 (a37); F4-A, A1–A6 (7957f9c9 and earlier); F4-B (a34, cfa3167); F4-O1–O4 (a27–a29); F4-R1–R9, R11; B1–B4, R1, N1, N2, N6. Notice wording (25 h, backup tail) is a draft, not an approved public claim.

## Coverage (accepted packets)

Intake/policy and moderation (F4-A, incl. pinned moderation/reports/recovery tests); admin paging UI (pager); engine and ledger (ops.ts, ledger.ts, purge.ts, 0009–0013); media lifecycle (photos.ts, placePhoto, the photo watch, withdrawal erasure, durable cleanup, refusal/preparation boundary); serving gates and projection (places.ts, index.ts, media-gate, share 410); replay targets (manual and automatic); transitions. Whole-phase fresh review: F4-R1..R12 (3a422d2..014686b).

## Tests (latest)

| command                             | commit    | result                                                                                                                                                                                                                  |
| ----------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash stages.sh static dev prod`    | `9c4b6b5` | Phase 4 checkpoint (Phase 5 runs them at its end): static clean, dev 87/87, prod 87/87 (`runs/20261006T160006-9c4b6b5/summary.tsv`); scripts 10/10 on `138e3e9` (unchanged since); the frame-rate check is P1, separate |
| `scripts/heavy npm test` (Worker)   | `52e649d` | 329/329 (`backend-phase5/runs/20261006T171228-a42-notes/`); a42 regressions seen red first (`…-a42-red2/`, `…`/approval note)                                                                                           |
| `scripts/heavy npm run test:client` | `52e649d` | 90/90; `npm run test:scripts` 10/10 (`backend-phase5/runs/20261006T171314-52e649d-client/`)                                                                                                                             |

Red checks where a test's sensitivity was in doubt (logs in `runs/*-c1*-mutations`).

## Independent choices since the restart

- held/ keeps a copy while a photo is published (no move deletes it); a standing photo watch (`media_checks`) re-checks moved photos hourly (target cadence) and erases withdrawn places' files.
- Purge tries reserved in SQL; fairness by `updated_at`; refusal cleanup derived from the stored row.
- Ledger entries carry suppression `targets`; photo lifecycle moved to `worker/db/photos.ts`.
- Workers Caching left off until staging (L1).

## Next action

Send the a42 corrective report (snapshot, base `90a8a50`, head `52e649d`; phase range `4f604de`..head). Then Phase 5 task 3 (Route A rule from `retention_runs`, export with manifest, Route B filtered import, export deletion at 35 days), then task 4 (tribute and audit pruning) and task 5 (shortened-time end-to-end run). Full dev/prod suites and the local merge at the end of the phase.

## Pending for Harel (not development)

Domain, mailbox, operator identity, real Turnstile/Email/R2, staging account, legal sign-off of the notices.
