-- 0005_report_suggestion: what the learner says the text should be (spec §8.10).
-- Older reports, and reports from older clients, have none.
alter table content_report add column suggestion text not null default '';
