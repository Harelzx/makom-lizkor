-- Delivery metadata only, alongside the existing contact and deleted with it. No message/outbox copy or plaintext token.
ALTER TABLE contacts ADD COLUMN verify_mail_state TEXT CHECK (verify_mail_state IN ('due', 'sending', 'accepted', 'retry', 'uncertain', 'stopped'));
ALTER TABLE contacts ADD COLUMN verify_mail_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN verify_mail_tried_at TEXT;
CREATE INDEX contacts_verification_due ON contacts(verify_mail_state, verify_mail_tried_at)
WHERE verify_mail_state IN ('due', 'retry', 'sending');
