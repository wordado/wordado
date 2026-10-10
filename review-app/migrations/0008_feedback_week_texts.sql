-- The paragraph the AI wrote about a period of feedback (spec 2026-10-10 §3.4), from topic titles and counts
-- only: nothing a learner wrote is here. `period` is "d:2026-10-10" for the tab's seven days up to that UTC day,
-- "w:2026-10-12" for the mail of the week that ended that Monday. It is text the AI derived, and goes with
-- Forget the AI's results. The previous Worker runs against this schema: it does not read this table.
CREATE TABLE feedback_week_texts (
  period TEXT PRIMARY KEY,
  paragraph TEXT NOT NULL,
  made_at TEXT NOT NULL
);
