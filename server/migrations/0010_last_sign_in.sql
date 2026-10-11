-- 0010_last_sign_in: when each account was last signed in, for the deletion of accounts not signed in to for
-- 24 months (#187, src/account/sweep.ts). Written at each sign-in and each time a session is extended
-- (src/account/lastSignIn.ts). Sessions do not hold it: they go 60 days after their last use.
alter table "user" add column last_sign_in_at timestamptz;
-- The accounts already there: when they last signed in was never kept, and no row left says it for certain (a
-- session signed out of is gone). They are dated from today, so that none is deleted sooner than 24 months
-- after its true last sign-in. An account with no date is never taken by the sweep.
update "user" set last_sign_in_at = now();
create index user_last_sign_in_at on "user" (last_sign_in_at);

-- The UTC days on which the sweep ran, and how many accounts each run deleted: at most one run a day, and the
-- counts the review app shows. Numbers only: nothing here says whose the accounts were.
create table account_sweep (
  utc_day integer primary key,
  -- Epoch milliseconds, by the server's clock.
  ran_at bigint not null,
  deleted integer not null default 0
);
