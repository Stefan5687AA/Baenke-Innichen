DROP TABLE IF EXISTS trail_sign_entries;
DROP TABLE IF EXISTS trail_signboards;
DROP TABLE IF EXISTS trail_poles;
DROP TABLE IF EXISTS bench_history;
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

CREATE TABLE trail_poles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_number TEXT NOT NULL CHECK (length(trim(site_number)) > 0),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trail_poles_active ON trail_poles(active);
CREATE INDEX idx_trail_poles_site_number ON trail_poles(site_number);

CREATE TABLE trail_signboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pole_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (length(trim(direction)) > 0),
  trail_number TEXT NOT NULL CHECK (length(trim(trail_number)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  FOREIGN KEY (pole_id) REFERENCES trail_poles(id) ON DELETE CASCADE
);

CREATE INDEX idx_trail_signboards_pole_id ON trail_signboards(pole_id);
CREATE INDEX idx_trail_signboards_sort_order ON trail_signboards(pole_id, sort_order);

CREATE TABLE trail_sign_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signboard_id INTEGER NOT NULL,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  duration TEXT CHECK (duration IS NULL OR length(trim(duration)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  FOREIGN KEY (signboard_id) REFERENCES trail_signboards(id) ON DELETE CASCADE
);

CREATE INDEX idx_trail_sign_entries_signboard_id ON trail_sign_entries(signboard_id);
CREATE INDEX idx_trail_sign_entries_sort_order ON trail_sign_entries(signboard_id, sort_order);
