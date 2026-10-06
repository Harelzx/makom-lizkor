-- The tracking mail after an address is verified: whether it went out, and how many times it was tried, so a later
-- click on the confirmation page can send it again (a few times at most) when the first send failed.
ALTER TABLE contacts ADD COLUMN tracking_mail_sent_at TEXT;
ALTER TABLE contacts ADD COLUMN tracking_mail_attempts INTEGER NOT NULL DEFAULT 0;
