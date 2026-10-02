-- 0004_spanish: a third learner language (plan 12). Reminders may be sent in Spanish.
alter table push_subscription drop constraint push_subscription_language_check;
alter table push_subscription add constraint push_subscription_language_check check (language in ('bg', 'de', 'en', 'es'));
