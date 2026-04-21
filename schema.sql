DROP TABLE IF EXISTS benches;

CREATE TABLE benches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'good' CHECK (status IN ('good', 'ok', 'to_check', 'repair', 'removed')),
  last_inspection TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX idx_benches_active ON benches(active);
CREATE INDEX idx_benches_status ON benches(status);

CREATE TABLE bench_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bench_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'Admin',
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bench_history_bench_id ON bench_history(bench_id);
CREATE INDEX idx_bench_history_created_at ON bench_history(created_at);
