-- 0006_feedback: what a learner tells us about the app itself (spec §8.12),
-- apart from the reports on words. Kept when the account is deleted, with the
-- account and the contact address removed (spec §11).
create table feedback (
  id bigint generated always as identity primary key,
  -- The account, when the sender was signed in.
  user_id text references "user" (id) on delete set null,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  message text not null,
  -- Where to answer; empty when the sender wants none.
  contact_email text not null default '',
  -- The details the form shows under its fields.
  app_version text not null,
  corpus_version text not null,
  user_agent text not null,
  language text not null,
  screen text not null,
  -- Epoch milliseconds, by the server's clock.
  received_at bigint not null,
  -- When the daily mail carried it; null until then.
  mailed_at bigint
);
create index feedback_user on feedback (user_id);
create index feedback_unmailed on feedback (received_at) where mailed_at is null;

-- Every message kept, so one client, or everyone together, cannot fill the
-- table (src/feedback/limit.ts). `client` is a keyed hash of the address the
-- request came from, never the address; the cron drops every row a day old.
create table feedback_send (
  id bigserial primary key,
  client text not null,
  sent_at bigint not null
);
create index feedback_send_client on feedback_send (client, sent_at);
create index feedback_send_sent_at on feedback_send (sent_at);

-- The UTC days on which the feedback mail was tried: at most one a day, sent
-- or not, since the mail allowance is shared with sign-in codes (spec §17.2).
create table feedback_mail (
  utc_day integer primary key,
  attempted_at bigint not null
);
