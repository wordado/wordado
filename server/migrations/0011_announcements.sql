-- 0011_announcements: a mail to account holders, written in the review app and sent by the cron (#185,
-- src/announcements/). Two kinds, kept apart: a service notice goes to every account holder, news only to the
-- accounts that consented to it (0009), each mail with a link that withdraws the consent.
create table announcement (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('service', 'news')),
  -- Subject and body per language, English always among them: {"en": {"subject": "…", "body": "…"}, "bg": {…}}.
  texts jsonb not null,
  -- Raised by every change of a draft. A test send names the version it mailed, and only that version can be sent.
  version integer not null default 1,
  tested_version integer,
  -- A draft can be changed. Once sending starts nothing of it changes again, and there is no way back to draft:
  -- an announcement is sent once.
  status text not null default 'draft' check (status in ('draft', 'sending', 'stopped', 'sent')),
  -- Epoch milliseconds, by the server's clock.
  created_at bigint not null,
  updated_at bigint not null,
  started_at bigint,
  stopped_at bigint,
  finished_at bigint,
  -- Why the last run sent nothing or stopped early, and when: 'day' (the day's own allowance of announcement
  -- mails is used), 'quota' (the provider says its allowance is), 'busy' (the provider takes nothing now). Null
  -- after a run that met none of them.
  held_reason text check (held_reason in ('day', 'quota', 'busy')),
  held_at bigint,
  -- Counts only, kept here so that they stay when an account, and with it its row below, is deleted.
  recipients integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  -- News only: the consent was withdrawn between the start and this account's turn.
  skipped integer not null default 0,
  check ((status = 'draft') = (started_at is null))
);

-- One row for each account an announcement goes to, written when sending starts: who gets it is fixed then, so an
-- account made later is not among them. The row is what lets a run that stopped anywhere go on without mailing
-- anyone twice. It goes with the account (the learner's own deletion and the sweep of inactive accounts alike).
create table announcement_delivery (
  announcement_id bigint not null references announcement (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  -- The account's interface language as far as the server knows it, 'en' when it does not.
  language text not null check (language in ('bg', 'de', 'en', 'es')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  -- What the provider is told this mail is: asked twice with one key, it sends once. A new key only after an
  -- answer that says the mail was not sent.
  send_key uuid not null default gen_random_uuid(),
  -- A try whose outcome is not known yet or never became known: when it was last made, when the key was first
  -- used, and how many there were. All back to nothing when the provider answers that it did not send.
  claimed_at bigint,
  first_tried_at bigint,
  attempts integer not null default 0,
  done_at bigint,
  primary key (announcement_id, user_id)
);
create index announcement_delivery_queued on announcement_delivery (announcement_id) where status = 'queued';
create index announcement_delivery_user on announcement_delivery (user_id);

-- How many announcement mails went on each UTC day, test sends among them: the provider's daily allowance is
-- shared with the sign-in codes, so a day's announcements are held to a part of it. Numbers only.
create table announcement_mail_day (
  utc_day integer primary key,
  mails integer not null default 0
);
