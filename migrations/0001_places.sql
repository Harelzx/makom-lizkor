CREATE TABLE places (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL CHECK (origin IN ('curated', 'contribution')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'returned', 'published', 'hidden', 'rejected', 'withdrawn', 'erased')),
  rev INTEGER NOT NULL,
  published_revision_id TEXT,
  tracking_token_hash TEXT,
  last_transition_id TEXT,
  created_at TEXT NOT NULL,
  status_changed_at TEXT NOT NULL
);

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id),
  n INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'returned', 'approved', 'rejected', 'superseded', 'withdrawn')),
  kind TEXT,
  name_he TEXT,
  lat REAL,
  lng REAL,
  location_precision TEXT CHECK (location_precision IN ('exact', 'approximate')),
  on_private_property INTEGER NOT NULL DEFAULT 0,
  location_permission_at TEXT,
  access_note_he TEXT,
  place_he TEXT,
  in_memory_of TEXT,
  story_he TEXT,
  link_url TEXT,
  consent_version TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  -- A place on private property is shown only approximately, unless the owner's permission and access details are on record.
  CHECK (on_private_property = 0 OR location_precision = 'approximate'
         OR (location_permission_at IS NOT NULL AND access_note_he IS NOT NULL))
);
CREATE INDEX revisions_by_place ON revisions(place_id, n);

-- Optional contact details, kept apart from the content so they can be purged on their own deadline.
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  place_id TEXT REFERENCES places(id),
  report_id TEXT,
  name TEXT,
  email TEXT,
  email_verified_at TEXT,
  consent_version TEXT,
  created_at TEXT NOT NULL,
  ceiling_at TEXT NOT NULL,
  purge_after TEXT NOT NULL,
  CHECK ((place_id IS NULL) <> (report_id IS NULL)),
  CHECK (purge_after <= ceiling_at)
);

CREATE TABLE feed_state (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL, changed_at TEXT NOT NULL);
INSERT INTO feed_state (id, n, changed_at) VALUES (1, 0, '1970-01-01T00:00:00.000Z');

-- What happened, never what was written: field names only, so erasing content never needs to scrub this table.
CREATE TABLE audit_log (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL, fields TEXT);
