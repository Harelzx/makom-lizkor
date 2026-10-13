-- No identifiers, request paths, addresses or content. Excluded from backups; pruned by the normal 15-minute pass.
CREATE TABLE request_metrics (
  hour TEXT NOT NULL,
  code TEXT NOT NULL,
  samples INTEGER NOT NULL,
  total_ms INTEGER NOT NULL,
  slow INTEGER NOT NULL,
  PRIMARY KEY (hour, code)
);
CREATE TABLE mail_budget (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('public', 'ops')),
  attempts INTEGER NOT NULL,
  PRIMARY KEY (day, kind)
);
