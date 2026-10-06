-- The ledger's chain for a place: one step per recorded decision, moved in the same statement as the decision itself.
-- Separate from rev, which a sender's own edits (a correction, a photo) also move without being decisions.
ALTER TABLE places ADD COLUMN ledger_seq INTEGER NOT NULL DEFAULT 0;

-- A request to remove or correct something on a place (spec 6). The place may be a curated one, which has no row here
-- until phase 7, so there is no foreign key. Everything a person wrote, and their address, is kept to purge_after only.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('contribution', 'curated')),
  elements TEXT NOT NULL,
  requester_type TEXT NOT NULL CHECK (requester_type IN ('family', 'rights_holder', 'other')),
  relationship TEXT,
  explanation TEXT,
  email TEXT,
  notice_version TEXT NOT NULL,
  submit_key_hash TEXT NOT NULL UNIQUE,
  body_hash TEXT NOT NULL,
  -- Spam signals, keyed so neither the text nor the address can be read back from them; purged with the body.
  explanation_hash TEXT,
  reporter_key TEXT,
  complete INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('hidden_for_review', 'received')),
  status TEXT NOT NULL CHECK (status IN ('open', 'in_review', 'closed')),
  -- When the 24-hour backstop looks again (spec 6), for a complete request the automatic path didn't act on.
  backstop_at TEXT,
  alerted_at TEXT,
  alerts INTEGER NOT NULL DEFAULT 0,
  handled_by TEXT,
  handling_note TEXT,
  received_at TEXT NOT NULL,
  closed_at TEXT,
  ceiling_at TEXT NOT NULL,
  purge_after TEXT NOT NULL,
  CHECK (purge_after <= ceiling_at)
);
CREATE INDEX reports_open ON reports(status, received_at);
CREATE INDEX reports_by_place ON reports(place_id);

-- What is hidden of a published place, element by element; the public sees the union of the active rows.
CREATE TABLE field_suppressions (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id),
  field TEXT NOT NULL CHECK (field IN ('name_he', 'in_memory_of', 'story_he', 'photo', 'whole')),
  report_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('precautionary', 'manual')),
  -- The published revision's number when it was hidden: a correction restores only if it is newer (and reviewed).
  revision_n INTEGER,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  reason TEXT,
  lifted_at TEXT,
  lifted_by TEXT,
  basis_code TEXT,
  basis_note TEXT,
  basis_detail TEXT,
  CHECK (lifted_at IS NULL OR (basis_code IS NOT NULL AND basis_note IS NOT NULL))
);
CREATE INDEX suppressions_active ON field_suppressions(place_id) WHERE lifted_at IS NULL;

-- Every recorded decision as a durable operation: written with the rev it expects before anything else happens, so a
-- crash between its steps is resumed, never redone against a newer state.
CREATE TABLE visibility_ops (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('moderator', 'automatic', 'submitter')),
  removal INTEGER NOT NULL,
  expected_rev INTEGER NOT NULL,
  seq_from INTEGER NOT NULL,
  rev_to INTEGER,
  result_status TEXT,
  detail TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'applied', 'refused')),
  refused_reason TEXT,
  intent TEXT NOT NULL CHECK (intent IN ('pending', 'written', 'failed', 'late')),
  media TEXT NOT NULL CHECK (media IN ('none', 'pending', 'done', 'failed')),
  ledger_commit TEXT NOT NULL CHECK (ledger_commit IN ('pending', 'written', 'failed')),
  purge TEXT NOT NULL CHECK (purge IN ('none', 'pending', 'done', 'failed', 'abandoned')),
  purge_tries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ops_unfinished ON visibility_ops(state, updated_at);
