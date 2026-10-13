-- A daily cap per visitor and place. The visitor is only ever a keyed hash of the address's visitor part and the day,
-- so it changes every day and can't be read back to an address; it goes with its row after the usual 8 days.
ALTER TABLE tribute_events ADD COLUMN address_key TEXT;
CREATE INDEX tribute_events_address ON tribute_events (place_id, day, address_key);
