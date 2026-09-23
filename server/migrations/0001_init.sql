-- 0001_init: Better Auth's tables and the sync store (spec §6.2).

-- Better Auth 1.7.5, exactly as its getMigrations() compiles them for the
-- options in src/auth.ts (email OTP, Google, the country field, database rate
-- limiting). After upgrading Better Auth, compile again and add any
-- difference as a new migration.
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "country" text);

create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- One row per learner: the lock every push and pull takes, the one document
-- counter (plan 4: the pull cursor needs one sequence), and the scheduler
-- version the stored state was derived under (spec §4.3).
create table learner (
  user_id text primary key references "user" (id) on delete cascade,
  document_version bigint not null default 0,
  derived_scheduler_version text not null,
  rederive_requested_at bigint
);
create index learner_derived_scheduler_version on learner (derived_scheduler_version);

-- The device row (spec §6.2): the last event accepted from each device.
create table device (
  user_id text not null references "user" (id) on delete cascade,
  device_id text not null,
  device_seq bigint not null,
  effective_ts bigint not null,
  primary key (user_id, device_id)
);

-- The append-only answer log (spec §6.2). Not partitioned in Phase 1a: every
-- query is one learner's range of the primary key or an index below.
create table review_event (
  user_id text not null references "user" (id) on delete cascade,
  -- As the client sent it.
  review_id text not null,
  word_id text not null,
  mode text not null,
  direction text not null,
  grade smallint not null check (grade between 1 and 4),
  latency_ms integer not null,
  practice boolean not null,
  client_ts bigint not null,
  client_tz_offset_min smallint not null check (client_tz_offset_min between -720 and 840),
  device_id text not null,
  device_seq bigint not null,
  scheduler_version text not null,
  -- As the server stamped it; never updated (spec §9.2 step 5).
  received_at bigint not null,
  effective_ts bigint not null,
  xp_eligible boolean not null,
  -- Days fixed by the stamp, for the queries below; never updated.
  client_local_day integer not null,
  local_day integer not null,
  utc_day integer not null,
  -- core's derivation kept as an index. src/sync/derive.ts rewrites these,
  -- and nothing else does.
  kind text not null default 'new' check (kind in ('new', 'review', 'repeat', 'practice')),
  xp_award integer not null default 0,
  primary key (user_id, review_id)
);
create index review_event_word on review_event (user_id, word_id);
create index review_event_local_day on review_event (user_id, local_day);
create index review_event_utc_day on review_event (user_id, utc_day);
create index review_event_client_local_day on review_event (user_id, client_local_day);

-- core's replay per word, as the pull sends it.
create table review_state (
  user_id text not null references "user" (id) on delete cascade,
  word_id text not null,
  state jsonb not null,
  primary key (user_id, word_id)
);

-- Completed days (spec §8.4): immutable once accepted.
create table day_complete (
  user_id text not null references "user" (id) on delete cascade,
  local_date text not null check (local_date ~ '^\d{4}-\d{2}-\d{2}$'),
  rule_version text not null,
  received_at bigint not null,
  primary key (user_id, local_date)
);

-- Versioned and server-owned documents (spec §9.2).
create table document (
  user_id text not null references "user" (id) on delete cascade,
  type text not null,
  key text not null,
  class text not null check (class in ('versioned', 'server_owned')),
  version bigint not null,
  fields jsonb not null,
  field_versions jsonb not null,
  deleted boolean not null default false,
  primary key (user_id, type, key)
);
create index document_version on document (user_id, version);

-- The window of a push in progress (spec §9.2 step 1), deleted after its last
-- page and, if that never arrives, a day after it opened.
create table push_window (
  user_id text not null references "user" (id) on delete cascade,
  device_id text not null,
  push_id text not null,
  clock_offset_ms bigint not null,
  lower_bound bigint not null,
  upper_bound bigint not null,
  carry jsonb not null,
  opened_at bigint not null,
  primary key (user_id, device_id, push_id)
);
create index push_window_opened_at on push_window (opened_at);

-- Content reports (spec §8.10), kept with the reporter removed when the
-- account is deleted (spec §11).
create table content_report (
  id bigint generated always as identity primary key,
  reporter_id text references "user" (id) on delete set null,
  report_key text not null,
  word_id text not null,
  field text not null,
  note text not null,
  pack_version integer not null,
  created_at bigint not null,
  received_at bigint not null,
  unique (reporter_id, report_key)
);
create index content_report_word on content_report (word_id, field);

-- Web Push reminders (spec §8.11). The keys are kept for a future payload;
-- Phase 1a pushes carry none.
create table push_subscription (
  endpoint text primary key,
  user_id text not null references "user" (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  reminder_minute smallint not null check (reminder_minute between 0 and 1439),
  tz_offset_min smallint not null check (tz_offset_min between -720 and 840),
  language text not null check (language in ('bg', 'en')),
  streak_nudge boolean not null default false,
  ignored integer not null default 0,
  last_sent_at bigint,
  last_reminder_day integer,
  last_nudge_day integer,
  created_at bigint not null
);
create index push_subscription_user on push_subscription (user_id);
