-- 0012_interface_language: the language an account's interface is in (#199), as the app says it at sign-in and
-- whenever the learner changes it (src/account/interfaceLanguage.ts). Announcements are written to the account in
-- it (src/announcements/store.ts). Every account that exists has none: the app says it the next time it is opened,
-- and until then the older signs of a language are read, as before.
alter table "user" add column interface_language text check (interface_language in ('bg', 'de', 'en', 'es'));
