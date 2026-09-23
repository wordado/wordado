-- 0002_sign_in_code_sends: every sign-in code the server emailed, so one
-- address, or everyone together, stays inside the email provider's daily
-- allowance (spec §17.2). The address is personal data: account deletion
-- removes its rows, and the cron drops every row a day old.
create table sign_in_code_send (
  id bigserial primary key,
  email text not null,
  -- Epoch milliseconds, by the server's clock.
  sent_at bigint not null
);
create index sign_in_code_send_email on sign_in_code_send (email, sent_at);
create index sign_in_code_send_sent_at on sign_in_code_send (sent_at);
