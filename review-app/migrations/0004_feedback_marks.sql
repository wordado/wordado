-- What the coordinator adds to a learner's feedback about the app (spec 2026-10-05 §16): where it stands and a note,
-- by the id the learner app's server gives the message. The message itself, the address given for an answer and the
-- technical details are never copied here: they are read from that server each time the Feedback tab is opened, so
-- an account deleted there leaves nothing behind here. A message with no row is new. The previous Worker runs
-- against this schema: it never reads the table.
CREATE TABLE feedback_marks (
  feedback_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('new', 'seen', 'done', 'declined')),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES reviewers(email)
);
