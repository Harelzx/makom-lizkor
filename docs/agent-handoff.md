# Continuation record: backend session

The backend session's current handoff. Read it after any restart, compaction or recovery, together with the CLAUDE.md section "Delegated adviser while Harel is away", the bundle's `CLAUDE-HANDOFF.md` and `policy.md` (workflow revision 4.1), and `SECOND-AUDIT-CHECKPOINT-AND-RESUME.txt` section B. The full earlier consultation history is in this file's git history (up to `91436cd`) and in the bundle's `runtime/`.

## Checkpoint (2026-10-06 ~11:45, before Harel's Mac restart)

- Worktree: `/Users/harel/Desktop/remember_07102026/web/.claude/worktrees/system-architecture-design-9a660f`, branch `claude/system-architecture-design-9a660f`.
- HEAD: the commit that carries this record, on top of `2a3c943` (code). `main` = `7939b5f` (merged into the branch at `47ea389`). Nothing pushed, nothing deployed. Working tree clean after this commit; no test mutation in place.
- Durable evidence (outside git, synthetic data only): `/Users/harel/Desktop/remember_07102026/agent-evidence/backend-phase4/`
  - `reports/`: every implementation report (`phase4-*.json`, latest `phase4-h.json`), question files (`q*.txt`, latest `q24-p2b.txt`), adviser answers (`a*.json`, latest `a23.json` = d685d7f0), dry runs.
  - `runs/<time>-<head>/`: per-stage logs and `summary.tsv` from the stage runner.
  - `logs/`: Worker logs (`worker-e.log` = 265/265 on `0ef5d59`), `mod-red.txt` and `mod-green.txt` (the F4-A contact fix), `release-gate-report.md`.
  - `stages.sh` (the stage runner, `ROOT` now points at `runs/` here), `full.sh`, `excerpt.py`, `escape.py`.
  - The session scratchpad under `/private/tmp` is gone after the restart; use only this folder.

## What exists (user-visible flows)

| flow                                                                                                                                                                                                                         | state                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Phases 1–3 (submissions, tracking, withdrawal, anemones, share pages `/place/<id>`)                                                                                                                                          | merged locally into `main` at `472ce14`       |
| Phase 4 tasks 1–2: durable visibility operations and the R2 ledger (`worker/db/ops.ts`, `worker/lib/ledger.ts`, migrations 0009–0010)                                                                                        | on the branch, not merged                     |
| Phase 4 task 3: removal requests `POST /api/v1/reports` (predicate, precautionary hides under atomic safeguards, replay first)                                                                                               | on the branch (API only; no visitor form yet) |
| Phase 4 task 4: suppressions in the public feed and share pages, `/admin/` requests, manual hides, documented restoration, paged lists (migration 0011)                                                                      | on the branch                                 |
| Phase 4 task 5: scheduled job (`worker/jobs.ts`: resume ops, 24-hour backstop, reminders, abuse-code clearing with a hard ceiling)                                                                                           | on the branch                                 |
| Phase 4 task 6: the visitor's request form in the place card (privacy session's three result texts verbatim, notice `notice.report@2026-10-2`), hidden-name display, quiet close of an open card whose place was hidden, e2e | **not started**                               |
| Phase 4 task 7: per-place share image decision (with the adviser)                                                                                                                                                            | **not started**                               |
| Phase 4 checkpoint: fresh whole-phase review, full dev/prod functional e2e, report, local `--no-ff` merge, `scripts/milestone`, tell the privacy session (it waits to run `npm test` on main)                                | **not started**                               |
| Phases 5–7                                                                                                                                                                                                                   | not started                                   |

## Adviser state

Latest: `20261006T083017Z-d685d7f0` (revise; partial packet, not phase or merge approval). It accepted F4-A6's server paging and the recalled 6954a5f2 restoration rules except the contact guard. That guard is now fixed in `2a3c943`: `requester_withdrew` and `family_requested_restore` need `familyContact` whoever asked for the hide. The verified request itself may be the record. The fix is not yet reported to the adviser.

Recent chain: b03acd0b → bc46a39c → 5131154b → bb965446 → 4889666d → d685d7f0, all "revise" with fixes made; each answer is in `reports/a18.json`…`a23.json` and in the bundle's `runtime/<id>/answer.json`.

## Since the restart (2026-10-06 afternoon)

- `71d0f91`: F4-A6 UI fix (pager). Adviser `20261006T092913Z-7957f9c9` (proceed): F4-A, F4-A2, F4-A4, F4-A6 closed. Note: `92f9dc29` was the revise before it; cite 7957f9c9 for the closures.
- Packet 3 (engine/ledger) → `a26.json` (revise). Open in one corrective batch, delta from `71d0f91`:
  - F4-O1 refused ops can't repair a missing abort (abortRecorded ignores write failure; resumeOps skips refused).
  - F4-O2 placePhoto races: older hide's delete of public/ after a newer restore deleted held/ → both copies gone. Need fencing/safe cleanup, barrier tests both orders incl. prepare/cleanup.
  - F4-O3 finishOp progress overwrites (non-monotonic, lost purge tries); resumeOps oldest-100 starvation; per-op failure isolation.
  - F4-O4 replay: abort-only / intent+abort withdraw/erase must not count as erased; document/test the fromSeq window.
  - Also: L1 wording (verify ctx.cache.purge in Cloudflare docs; missing support = success only in explicit local/test mode); remove the ledger comment's claim that ids are non-personal and justify lifetime retention.
  - `e548ab5` fixed O1..O4 → adviser `a27.json` (revise): O1, O4 closed; O3 step monotonicity + fairness accepted. Still open (delta from e548ab5):
    - O2: durable media reconciliation in the scheduled path regardless of op flags (late delete then caller dies), refused-prepare cleanup durable, served photo with no bytes = media failure not success.
    - O3 purge: reserve retry slots atomically before calling purge; late success sets done; stale failure can't undo; interrupted reservation accounting; purge.test must capture the real options argument.
  - Packet 4 must add retirePhotos and prepare/cleanup callers, and show that lifting one of two same-field suppressions is reconstructible from the ledger (add target ids to LedgerEntry if needed). `ops-transitions.test.ts` moved to packet 4 for size.

## Open findings (one list, stable IDs)

| id     | what                                                                                                                                                | class                                                | closure needed                                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| F4-A   | intake and policy: restoration contact guard (fixed `2a3c943`, unreported) plus moderation/alert-mail test coverage                                 | merge-blocking                                       | report the fix with `moderation.test.ts` and `reports.test.ts` (planned call 2)                                                          |
| F4-A2  | backstop claim taken over mid-hide: design accepted                                                                                                 | merge-blocking (evidence provenance only)            | attach the pinned `66b08fd..505f03b` delta of `worker/test/report-recovery.test.ts`                                                      |
| F4-A4  | fault inside the round's batch, concurrent rounds: designs accepted                                                                                 | merge-blocking (evidence provenance only)            | same delta as F4-A2                                                                                                                      |
| F4-A6  | paging of both admin queues: server accepted                                                                                                        | merge-blocking (UI evidence only)                    | attach `505f03b..0ef5d59` of `src/admin/reports.tsx` and `e2e/reports.spec.ts` with the surrounding paging code; don't resend the server |
| F4-B   | engine and visibility coverage: 0009, 0010, `ledger.ts`, `ops.ts`, `purge.ts`, `places.ts`, `index.ts`, `submissions.ts`, `dev.ts` with their tests | merge-blocking                                       | packets 3 (engine/ledger) and 4 (visibility); the F4-R1–R9 fixes ride with them                                                          |
| E4-1   | full dev/prod e2e: one test past its 30 s budget per run at load 11–12, a different one each time; isolated reruns pass                             | merge-blocking                                       | passing full dev and prod functional suites at the stable checkpoint, on a machine with room                                             |
| F4-R10 | held copy vs withdrawal race                                                                                                                        | nonblocking (public gating in F4-B, cleanup Phase 5) | —                                                                                                                                        |
| F4-R12 | intake/replay interruption                                                                                                                          | nonblocking                                          | durable recovery and non-final client wording in task 6                                                                                  |
| P1     | frame-rate check failed last prod measurement (2.19 vs 1.69 long frames/s at load 7–9)                                                              | launch-only                                          | `perf-prod` on a quiet machine                                                                                                           |
| L1     | real CDN/photo purge, browser cache, origin and release gates                                                                                       | launch-only                                          | staging                                                                                                                                  |
| L2     | Phase 5 retention jobs (30-day erase, tribute pruning, photo sweep, provider deletion tail)                                                         | launch-only                                          | Phase 5                                                                                                                                  |
| L3     | curated demo data out of the Worker                                                                                                                 | launch-only                                          | Phase 7                                                                                                                                  |

Closed and carried forward: B1–B4, R1, N1, N2, N6 (Phase 2–3); F4-R1–R9, R11; F4-A1, F4-A3, F4-A5 (source accepted). Nonblocking notes N3–N5 unchanged. The report notice wording (25 h, backup tail) is a draft, not an approved public claim.

## Tests (exact)

| command                                                                 | commit           | result                                                                                                                                                                      | evidence                                        |
| ----------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `scripts/heavy npx vitest run worker/test/moderation.test.ts`           | `2a3c943` (tree) | 24/24; the 4 new cases failed first (200 instead of 422)                                                                                                                    | `logs/mod-red.txt`, `logs/mod-green.txt`        |
| `npm run -s lint`, `npx prettier --check` (changed files), `npx tsc -b` | `2a3c943`        | clean                                                                                                                                                                       | this session                                    |
| `scripts/heavy npm test` (Worker)                                       | `0ef5d59`        | 265/265                                                                                                                                                                     | `logs/worker-e.log`                             |
| `scripts/heavy npx playwright test e2e/reports.spec.ts`                 | `0ef5d59`        | 2/2                                                                                                                                                                         | run in session; Playwright output not preserved |
| `stages.sh worker client scripts static dev prod`                       | `22d7872`        | Worker 238/239 (E4-2: the thousand-file erasure test over 5 s; since given a measured 15 s budget), client 43/43, scripts 10/10, static clean, dev 70/71, prod 70/71 (E4-1) | `runs/20261006T094922-22d7872/`                 |

Uncertain: the full Worker suite has not run on `2a3c943` (only the moderation file changed in code). Client, scripts and full e2e are historical (`22d7872`). Phase 4 changes since then touch the admin UI and the Worker.

## Independent choices since the last record

- Keyset paging (time, id), 50 per page, cursor `<iso>|<id>`, 400 on a malformed cursor (F4-A6).
- The contact guard applies to the two requester codes on any hide; `verificationNote` stays a separate requirement (d685d7f0).
- Test-only fault injection uses a test-scoped trigger or a D1 proxy; mutation checks confirmed the recovery tests (SAFE, evidence expiry, claim fence, atomic round).

## Next action after the restart

1. Send corrective call 2 as one delta packet (rules 4.1: `base_commit` = `0ef5d59`, `head_commit` = current, real merge range `7939b5f..HEAD` in the summary). Include the `2a3c943` contact fix with `worker/test/moderation.test.ts` and `worker/test/reports.test.ts` (alert mail), the F4-A6 UI delta (`src/admin/reports.tsx`, `e2e/reports.spec.ts`), and the `66b08fd..505f03b` recovery-test delta. Run one dry run; split only if over 48,000 bytes. Before sending, run the Worker suite once through `scripts/heavy` and measure load first.
2. Then packets 3 and 4 (F4-B), task 6, task 7, and the Phase 4 checkpoint as listed above.

## Pending for Harel (not development)

Domain, mailbox, operator identity, real Turnstile/Email/R2, staging account, legal sign-off of the notices.
