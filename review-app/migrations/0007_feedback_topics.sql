-- Topics group messages about the same thing (spec 2026-10-10 §3.2). A title is in our words, written by the AI
-- or by the coordinator; nothing a learner wrote is here. `updated_by` is empty until the coordinator has worked
-- on a topic. `issue` is the known issue a topic looks like: proposed by the AI, confirmed or removed by the
-- coordinator. The previous Worker runs against this schema: it never names the new columns of feedback_ai, and
-- they have defaults.
CREATE TABLE feedback_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL COLLATE NOCASE UNIQUE,
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'seen', 'done', 'declined')),
  note TEXT NOT NULL DEFAULT '',
  issue INTEGER,
  issue_state TEXT NOT NULL DEFAULT 'none' CHECK (issue_state IN ('none', 'proposed', 'confirmed', 'removed')),
  renamed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES reviewers(email)
);
-- A message's topic, and who put it there: one the coordinator chose is never changed by a later reading.
ALTER TABLE feedback_ai ADD COLUMN topic_id INTEGER REFERENCES feedback_topics(id);
ALTER TABLE feedback_ai ADD COLUMN topic_by TEXT NOT NULL DEFAULT 'ai' CHECK (topic_by IN ('ai', 'coordinator'));
CREATE INDEX feedback_ai_topic ON feedback_ai (topic_id);
-- The open issues of the public app repository: number and title, as last read (spec 2026-10-10 §3.3).
CREATE TABLE open_issues (
  number INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  read_at TEXT NOT NULL
);
-- One row for each UTC day on which they were read, taken before the read: at most one read a day, whatever came
-- of it. `outcome` is empty while a read is on its way, or when it never ended.
CREATE TABLE open_issues_reads (
  day TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  outcome TEXT
);
