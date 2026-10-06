-- A refused operation's abort is a step of its own, tracked like the others, so one the ledger refused or a stopped
-- Worker never wrote is written by the scheduled job: without it a refused removal's intent replays as if it happened.
ALTER TABLE visibility_ops ADD COLUMN abort TEXT NOT NULL DEFAULT 'none' CHECK (abort IN ('none', 'pending', 'written', 'failed'));
-- Refusals from before this column: the abort's key is fixed by the operation, so writing it again is harmless.
UPDATE visibility_ops SET abort = 'pending' WHERE state = 'refused';
