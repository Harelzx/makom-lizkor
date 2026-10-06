-- A tombstone keeps why it was erased (spec 3.2): 'returned_expired' (returned and not corrected in time) or
-- 'rejected_expired' (a refused submission's text, after its days). Withdrawals stay 'withdrawn'.
ALTER TABLE places ADD COLUMN erased_reason TEXT;

-- Each run of the retention job, counts only. A restore in place (spec 7, Route A) may go back no earlier than the
-- end of the last run that finished: what it erased must never return.
CREATE TABLE retention_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  counts TEXT
);
CREATE INDEX retention_runs_done ON retention_runs(ok, finished_at);

-- When a job's stall was last reported to the moderators (the retention job: no finished run in RETENTION_ALERT_HOURS),
-- so a stall is reported again every few hours while it lasts, and not every 15 minutes.
CREATE TABLE job_alerts (job TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
