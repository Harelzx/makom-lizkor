-- A daily ceiling of submissions per visitor, so one address can't fill the review queue for everyone. The visitor is
-- only ever a keyed hash of the address's visitor part (worker/lib/ids.ts rateKey), never the address; a row goes after
-- two days with the other operational counters, and the table is never exported or restored.
CREATE TABLE submission_senders (
  place_id TEXT PRIMARY KEY,
  visitor TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX submission_senders_visitor ON submission_senders (visitor, at);
