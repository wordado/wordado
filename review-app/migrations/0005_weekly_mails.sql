-- One row for each week the weekly mail was looked at (spec 2026-10-10 §3.4), so that a job run twice sends one
-- mail. `week` is the UTC date of the Monday the week ended on. `messages` is null while a run holds the row and
-- has not finished; `sent_at` is null when nothing was sent, because no feedback came. Nothing a learner wrote is
-- here. The previous Worker runs against this schema: it never reads the table.
CREATE TABLE weekly_mails (
  week TEXT PRIMARY KEY,
  claimed_at TEXT NOT NULL,
  messages INTEGER,
  sent_at TEXT
);
