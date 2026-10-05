-- A revision's photo: the R2 key (quarantine/ until approved, public/ after), its description and its photographer.
ALTER TABLE revisions ADD COLUMN photo_key TEXT;
ALTER TABLE revisions ADD COLUMN photo_alt TEXT;
ALTER TABLE revisions ADD COLUMN photo_credit TEXT;
