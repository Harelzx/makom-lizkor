-- A retried submission is the same submission: the browser sends one key per place, and the key (hashed) is unique.
-- The body's fingerprint tells a retry apart from a different submission that reuses a key.
ALTER TABLE places ADD COLUMN submit_key_hash TEXT;
ALTER TABLE places ADD COLUMN submit_body_hash TEXT;
CREATE UNIQUE INDEX places_submit_key ON places(submit_key_hash) WHERE submit_key_hash IS NOT NULL;
