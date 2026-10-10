-- Store less (#166). The age gate's country stays on the device; sessions keep no address or browser;
-- Better Auth's request limits are keyed by a hash from now on (src/rateLimitStore.ts), so the plain keys go;
-- feedback is no longer linked to the account nor mailed; Google sign-in is gone, and with it its account rows
-- (the learners keep their email address, and the emailed code signs them in).
alter table "user" drop column "country";
update "session" set "ipAddress" = null, "userAgent" = null where "ipAddress" is not null or "userAgent" is not null;
delete from "rateLimit";
delete from "account" where "providerId" <> 'credential';
alter table feedback add column signed_in boolean not null default false;
update feedback set signed_in = true where user_id is not null;
drop index if exists feedback_user;
drop index if exists feedback_unmailed;
alter table feedback drop column user_id, drop column mailed_at;
drop table feedback_mail;
