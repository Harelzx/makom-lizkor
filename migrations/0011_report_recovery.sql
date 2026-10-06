-- The backstop's claim is recoverable: a run that takes a request marks when, and a run that stopped before finishing
-- leaves the request to be taken again once the claim is stale. backstop_at is cleared only by a finished evaluation.
ALTER TABLE reports ADD COLUMN backstop_claimed_at TEXT;

-- One urgent alert or reminder to one moderator. Each is claimed before it is sent and marked sent after, so a run
-- that stopped mid-send is retried once its claim is stale, a failed recipient is retried at the next run, and a
-- recipient who got it isn't sent it again by routine. An ambiguous send (stopped after the provider took it) may go
-- twice: mail is never exactly once. Purged with its request (phase 5).
CREATE TABLE report_alerts (
  report_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'failed')),
  tries INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  sent_at TEXT,
  PRIMARY KEY (report_id, round, recipient)
);
CREATE INDEX report_alerts_due ON report_alerts(state, claimed_at);

-- What moderators wrote about a hide (its reason, and a lift's basis note and details) is kept to a deadline of its
-- own, like the request it may come from: at most 12 months from the hide, earlier once its case closes (90 days),
-- and never later than that once set. The phase 5 sweep blanks the text after notes_purge_after; the basis code, the
-- decision itself, stays.
ALTER TABLE field_suppressions ADD COLUMN notes_ceiling_at TEXT;
ALTER TABLE field_suppressions ADD COLUMN notes_purge_after TEXT;

CREATE TRIGGER suppression_notes_deadline_set
BEFORE INSERT ON field_suppressions
WHEN NEW.notes_ceiling_at IS NULL OR NEW.notes_purge_after IS NULL OR NEW.notes_purge_after > NEW.notes_ceiling_at
BEGIN
  SELECT RAISE(ABORT, 'suppression_notes_deadline');
END;

CREATE TRIGGER suppression_notes_deadline_only_earlier
BEFORE UPDATE OF notes_purge_after, notes_ceiling_at ON field_suppressions
WHEN NEW.notes_ceiling_at IS NOT OLD.notes_ceiling_at OR NEW.notes_purge_after > OLD.notes_purge_after
BEGIN
  SELECT RAISE(ABORT, 'suppression_notes_deadline');
END;
