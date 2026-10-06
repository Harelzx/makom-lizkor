-- Anemones (spec 4). One row per anemone sent; a retried tap is the same row (its key), and a device counts once per
-- place per Jerusalem day. The device is only ever a keyed hash that changes every day. Rows are kept 8 days (phase 5).
CREATE TABLE tribute_events (
  idempotency_key TEXT PRIMARY KEY,
  request_nonce   TEXT NOT NULL,
  place_id        TEXT NOT NULL REFERENCES places(id),
  day             TEXT NOT NULL,
  device_key      TEXT NOT NULL,
  received_at     TEXT NOT NULL,
  UNIQUE (place_id, day, device_key)
);
-- The public count per place, moved only by an event this request inserted (the nonce), in the same batch.
CREATE TABLE tribute_totals (
  place_id TEXT PRIMARY KEY REFERENCES places(id),
  total    INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0)
);
