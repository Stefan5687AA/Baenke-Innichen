BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS trail_poles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_number TEXT NOT NULL CHECK (length(trim(site_number)) > 0),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trail_poles_active ON trail_poles(active);
CREATE INDEX IF NOT EXISTS idx_trail_poles_site_number ON trail_poles(site_number);

CREATE TABLE IF NOT EXISTS trail_signboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pole_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (length(trim(direction)) > 0),
  trail_number TEXT NOT NULL CHECK (length(trim(trail_number)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  FOREIGN KEY (pole_id) REFERENCES trail_poles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trail_signboards_pole_id ON trail_signboards(pole_id);
CREATE INDEX IF NOT EXISTS idx_trail_signboards_sort_order ON trail_signboards(pole_id, sort_order);

CREATE TABLE IF NOT EXISTS trail_sign_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signboard_id INTEGER NOT NULL,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  duration TEXT CHECK (duration IS NULL OR length(trim(duration)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  FOREIGN KEY (signboard_id) REFERENCES trail_signboards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trail_sign_entries_signboard_id ON trail_sign_entries(signboard_id);
CREATE INDEX IF NOT EXISTS idx_trail_sign_entries_sort_order ON trail_sign_entries(signboard_id, sort_order);

COMMIT;
