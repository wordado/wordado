-- 0013_passkeys: the table of Better Auth's passkey plugin (#287), a second way to sign in beside the emailed code.
-- What is kept is what a sign-in needs: the credential's id and public key, its counter and kind, when it was added.
-- Not kept (store less, as in 0008): a name for the passkey, and the authenticator's model (aaguid), which says which
-- device or password manager the learner owns. The plugin would store both, so a trigger blanks them on every write.
-- Additive only.
create table "passkey" (
  "id" text not null primary key,
  "name" text,
  "publicKey" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "credentialID" text not null unique,
  "counter" integer not null,
  "deviceType" text not null,
  "backedUp" boolean not null,
  "transports" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP,
  "aaguid" text
);
create index "passkey_userId_idx" on "passkey" ("userId");

create function passkey_store_less() returns trigger language plpgsql as $$
begin
  new."name" := null;
  new."aaguid" := null;
  return new;
end;
$$;
create trigger passkey_store_less before insert or update on "passkey"
  for each row execute function passkey_store_less();
