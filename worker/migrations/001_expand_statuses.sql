BEGIN TRANSACTION;

CREATE TABLE benches_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'good' CHECK (status IN ('good', 'ok', 'to_check', 'repair', 'removed')),
  last_inspection TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO benches_new (id, title, lat, lng, status, last_inspection, notes, active, created_at, updated_at)
SELECT
  id,
  title,
  lat,
  lng,
  CASE status
    WHEN 'to_check' THEN 'ok'
    ELSE status
  END,
  last_inspection,
  notes,
  active,
  created_at,
  updated_at
FROM benches;

DROP TABLE benches;
ALTER TABLE benches_new RENAME TO benches;

CREATE INDEX idx_benches_active ON benches(active);
CREATE INDEX idx_benches_status ON benches(status);

COMMIT;
