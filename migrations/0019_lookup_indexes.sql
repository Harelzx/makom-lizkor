-- Additive only: no data, consent, visibility or expiry changes.
CREATE INDEX revisions_pending_created ON revisions(created_at) WHERE state = 'pending';
CREATE INDEX contacts_by_place ON contacts(place_id);
