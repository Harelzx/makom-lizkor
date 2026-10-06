-- A recorded decision lands only while its operation is still pending: one the scheduled job has refused as interrupted
-- (its prepared files cleaned up, an abort in the ledger) must not be applied by a request that was merely slow. As a
-- trigger, it holds for every decision, whoever writes the statement.
CREATE TRIGGER ops_land_only_pending
BEFORE UPDATE OF last_transition_id ON places
WHEN NEW.last_transition_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM visibility_ops WHERE id = NEW.last_transition_id AND state != 'pending')
BEGIN
  SELECT RAISE(ABORT, 'operation_not_pending');
END;
