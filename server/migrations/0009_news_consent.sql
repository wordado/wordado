-- Consent to news by email (#186). Every account that exists has no decision recorded: it is asked at its next
-- sign-in, as a new one is. The time is when the consent was given or withdrawn; the text names the wording and the
-- language it was given in (core/src/newsConsent.ts), and stays when the consent is withdrawn.
alter table "user"
  add column news_consent text not null default 'none' check (news_consent in ('none', 'given', 'withdrawn')),
  add column news_consent_at timestamptz,
  add column news_consent_text text,
  add constraint user_news_consent_recorded check (
    (news_consent = 'none') = (news_consent_at is null) and (news_consent = 'none') = (news_consent_text is null)
  );
