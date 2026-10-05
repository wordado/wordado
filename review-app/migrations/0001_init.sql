CREATE TABLE reviewers (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  languages TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reviewer', 'admin')),
  invited_at TEXT NOT NULL,
  invite_sent_at TEXT,
  disabled_at TEXT
);
CREATE TABLE assignments (
  id INTEGER PRIMARY KEY,
  reviewer TEXT NOT NULL REFERENCES reviewers(email),
  queue TEXT NOT NULL,
  files TEXT NOT NULL,
  flagged_only INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX assignments_open ON assignments (queue) WHERE closed_at IS NULL;
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY,
  assignment INTEGER NOT NULL REFERENCES assignments(id),
  branch TEXT NOT NULL,
  pr INTEGER,
  url TEXT,
  count INTEGER NOT NULL,
  left_out INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'merged', 'closed')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX submissions_pr ON submissions (pr) WHERE pr IS NOT NULL;
CREATE TABLE decisions (
  assignment INTEGER NOT NULL REFERENCES assignments(id),
  queue TEXT NOT NULL,
  file TEXT NOT NULL,
  key TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('accept', 'keep', 'edit', 'drop')),
  cells TEXT NOT NULL,
  note TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  submission INTEGER REFERENCES submissions(id),
  PRIMARY KEY (assignment, queue, key)
);
