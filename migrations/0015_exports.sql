-- The nightly export (spec 8.1): one row per attempt, written before anything is copied and marked ok only once its
-- manifest is written. Route A's rule reads retention_runs; the export's own gate is the retention run of its pass.
CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  retention_run TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  -- When its files were deleted (35 days, spec 7); the row stays as the record that they were.
  deleted_at TEXT
);
CREATE INDEX exports_done ON exports(ok, created_at);
