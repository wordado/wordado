-- A closed assignment's progress and spot-check result as they were when it was closed (#281), as JSON
-- { "progress": Progress, "spotCheck": SpotCheckResult | null }: the lists show them instead of counting an
-- assignment nobody works on against the current snapshot. Null for an open assignment, and for one closed before
-- this column or while no snapshot was there; the first list that shows such an assignment counts and keeps them.
-- The previous Worker runs against this schema: it does not read the column, and counts closed assignments live.
ALTER TABLE assignments ADD COLUMN frozen_progress TEXT;
