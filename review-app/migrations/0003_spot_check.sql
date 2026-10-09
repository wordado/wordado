-- A spot check (spec 2026-10-05 §15): an assignment over a random sample of the rows the AI review passed. The
-- sample is fixed when the assignment is made: its seed, and the rows as a JSON list of { file, key } in the order
-- they are shown. A decision that changes a spot-check row says how serious the fault was. Existing rows stay as
-- they are (not a spot check, no severity), and the previous Worker runs against this schema unchanged.
ALTER TABLE assignments ADD COLUMN spot_check INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assignments ADD COLUMN seed INTEGER;
ALTER TABLE assignments ADD COLUMN sample TEXT;
ALTER TABLE decisions ADD COLUMN severity TEXT CHECK (severity IN ('major', 'minor'));
