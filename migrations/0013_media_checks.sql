-- Places whose photo the scheduled job looks at again, whatever their operations' steps say: a move is registered here
-- before its writes, so a write that landed late after its Worker stopped is still put right (F4-O2).
CREATE TABLE media_checks (
  place_id TEXT PRIMARY KEY,
  due_at TEXT NOT NULL
);
CREATE INDEX media_checks_due ON media_checks(due_at);
