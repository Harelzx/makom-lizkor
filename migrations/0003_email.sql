-- The optional email (spec 11): a verification link first, then a tracking link of its own once verified.
-- Both are kept only as hashes, on the contact row, so they are erased with it.
ALTER TABLE contacts ADD COLUMN email_verify_hash TEXT;
ALTER TABLE contacts ADD COLUMN email_verify_expires TEXT;
ALTER TABLE contacts ADD COLUMN email_token_hash TEXT;
CREATE INDEX contacts_verify ON contacts(email_verify_hash) WHERE email_verify_hash IS NOT NULL;

-- Development only: the local mail adapter writes here instead of sending, so a developer and the tests can read it.
-- The production adapter never writes to it.
CREATE TABLE dev_outbox (id TEXT PRIMARY KEY, at TEXT NOT NULL, to_address TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL);
