CREATE TABLE IF NOT EXISTS bench_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bench_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'Admin',
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bench_history_bench_id ON bench_history(bench_id);
CREATE INDEX IF NOT EXISTS idx_bench_history_created_at ON bench_history(created_at);
