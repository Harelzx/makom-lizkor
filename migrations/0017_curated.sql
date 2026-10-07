-- Curated records (spec 3, 9; phase 7): the operator's own places, kept in D1 like contributions, each field with its
-- source and licence. Expand only (scripts/rollback-check.mjs): a nullable column and two new tables, with plain indexes.

-- What only a curated record carries, as JSON (CuratedFields in src/shared/contract.ts): year established, links,
-- where its coordinates came from, its region, and an attacked community's return. NULL on contributions.
ALTER TABLE revisions ADD COLUMN curated TEXT;
-- A moderator's write of a curated record carries an Idempotency-Key: a retry after a lost answer finds its revision,
-- and the same key with another body is refused (the hashes, never the key itself).
ALTER TABLE revisions ADD COLUMN request_key_hash TEXT;
ALTER TABLE revisions ADD COLUMN request_body_hash TEXT;
CREATE INDEX revisions_request_key ON revisions(request_key_hash) WHERE request_key_hash IS NOT NULL;

-- A curated revision's photos, each a file in the media bucket under public/ with its thumbnail: served, hidden,
-- exported, backed up and erased by key, like a contribution's one photo (revisions.photo_key), which stays where it is.
CREATE TABLE revision_photos (
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  idx INTEGER NOT NULL CHECK (idx >= 0),
  key TEXT NOT NULL,
  thumb_key TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  license TEXT NOT NULL,
  license_url TEXT,
  commons_url TEXT,
  subject_he TEXT,
  PRIMARY KEY (revision_id, idx)
);
CREATE INDEX revision_photos_key ON revision_photos(key);
CREATE INDEX revision_photos_thumb ON revision_photos(thumb_key);

-- Where each field of a revision came from, and under what licence (spec 9): coordinates, text, each photo by its
-- index, a community's return. A date taken from the repository rather than seen at retrieval is marked approximate.
CREATE TABLE place_sources (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id),
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  field TEXT NOT NULL CHECK (field IN ('coords', 'text', 'photo', 'revival')),
  photo_idx INTEGER,
  source TEXT NOT NULL CHECK (source IN ('osm', 'wikidata', 'commons', 'manual', 'survey', 'operator', 'web', 'contributor')),
  license TEXT,
  url TEXT,
  retrieved_at TEXT,
  retrieved_approx INTEGER NOT NULL DEFAULT 0 CHECK (retrieved_approx IN (0, 1)),
  CHECK ((field = 'photo') = (photo_idx IS NOT NULL))
);
CREATE INDEX place_sources_by_revision ON place_sources(revision_id);
CREATE INDEX place_sources_by_place ON place_sources(place_id);
