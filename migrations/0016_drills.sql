-- The weekly restore drill (spec 8.4): one row per run, with a failure code only (no data of anyone).
CREATE TABLE drill_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  export_id TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  failure TEXT
);
CREATE INDEX drill_runs_done ON drill_runs(ok, started_at);
