-- One submit at a time per assignment (spec 2026-10-05 §7.2): a submission is claimed (pr NULL) before any
-- GitHub write, and this index refuses a second claim while the first has no pull request yet.
CREATE UNIQUE INDEX submissions_claim ON submissions (assignment) WHERE pr IS NULL AND status = 'open';
