-- The AI's reading of a learner's feedback (spec 2026-10-10 §4), by the message's id, as the coordinator's marks
-- are kept. A translation and a summary are text derived from what a learner wrote, with addresses masked before
-- the model saw it; the message itself and the address for an answer are never here. One row a message: a newer
-- prompt version replaces it. `received_at` is the message's own time. The previous Worker runs against this
-- schema: it reads none of these tables.
CREATE TABLE feedback_ai (
  feedback_id INTEGER PRIMARY KEY,
  received_at INTEGER NOT NULL,
  language TEXT NOT NULL,
  translation TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('bug', 'idea', 'question', 'praise', 'junk')),
  severity TEXT CHECK (severity IN ('blocks', 'annoys', 'cosmetic')),
  summary TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX feedback_ai_received ON feedback_ai (received_at);
-- One row for each call to the model, counted before it is made, for the limit of calls a UTC day.
CREATE TABLE feedback_ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  at TEXT NOT NULL,
  what TEXT NOT NULL,
  messages INTEGER NOT NULL
);
CREATE INDEX feedback_ai_calls_day ON feedback_ai_calls (day);
-- What an admin switches in the app itself. `feedback_ai` is 'on' or 'off'; no row is off.
CREATE TABLE settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES reviewers(email)
);
