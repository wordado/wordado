-- 0003_second_l1: a second learner language (plan 10). Reports keep the L1 the
-- learner studied, so triage reopens only that language's translations; older
-- reports have none. Reminders may be sent in German.
alter table content_report add column l1 text;
alter table push_subscription drop constraint push_subscription_language_check;
alter table push_subscription add constraint push_subscription_language_check check (language in ('bg', 'de', 'en'));
