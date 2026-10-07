-- The production purge probe (L-PURGE, adviser a73 Q2): one content-free generation that a dedicated service token moves
-- on and purges by its own tag, so a release can watch the edge drop a copy it held. No place, person or content; the
-- exercise id makes a retried request answer the same without moving twice.
CREATE TABLE purge_probe (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  exercise TEXT
);
INSERT INTO purge_probe (id, generation) VALUES (1, 0);
