-- When the tracking mail was last tried: a later try waits a while, so clicks in quick succession can't spend all
-- five tries on one outage, and two clicks at once can't both send.
ALTER TABLE contacts ADD COLUMN tracking_mail_tried_at TEXT;
