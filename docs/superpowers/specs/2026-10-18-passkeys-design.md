# Passkeys beside the emailed code — design

**Date:** 2026-10-18 · **Status:** approved 2026-10-18, built by plan 2026-10-18-passkeys · **Issue:** #287
**Parent spec:** `2026-09-20-vocabulary-learning-app-design.md`, §8.6 (accounts and sign-in), §11 (export and
erasure).

## 1. Why

Signing in takes an emailed six-digit code. The learner leaves the app, finds the mail (sometimes in spam) and
types the code back in. Sessions last 60 days, so it is not often, but it happens on every new device and
browser and after every sign-out. The owner sees that step as a convenience problem, and one reason visitors
do not make an account.

A passkey signs in with the device's own unlock (fingerprint, face, PIN). It cannot be phished, sends nothing
to a third party, and the server keeps only a public key. Google sign-in was weighed again and stays out (#166):
it adds an outside processor that learns of each sign-in, and later an Apple sign-in requirement for iOS.

## 2. What the owner decided (2026-10-17)

- Passkeys are a **second** way to sign in. The emailed code stays: it creates every account, signs in on a
  device with no passkey, and recovers access.
- The scope in #287: the server plugin, an offer after a code sign-in, a passkey button and autofill on the
  sign-in screen, a list in settings with removal, deletion and export, strings in every language, the spec
  and the privacy policy, server and browser tests.
- Left out: other outside sign-ins; passkeys as the only way in or accounts without an email; native passkeys in
  the mobile apps (they come with the apps, and the choice in §4 leaves room for them).

## 3. Goals, non-goals, anti-goals

**Goals**

- A returning learner on a device with a passkey signs in with one tap and the device unlock, no mail.
- Every learner who signs in with a code is offered a passkey once on that device, and can decline for good.
- The learner sees their passkeys in settings and can remove any of them.

**Non-goals**

- Creating an account with a passkey. An account is made only by the email code and the age step (#293).
- Naming passkeys, or showing which device or password manager holds one.
- Sign-in on the preview carrying over to production, or the reverse.

**Anti-goals** (failures even if it works)

- The server keeps something about the learner's device it does not need: a device name, a browser string, the
  authenticator's model.
- The code path gets slower, longer or harder to find. A learner who never wants a passkey sees one offer and
  one button, nothing more.
- The offer interrupts what the sign-in was for: the demo's progress carrying over, or the notice that the demo
  was discarded (#293).
- A removed passkey still signs in.
- A passkey sign-in on a device holding another account's progress mixes the two (the rule of
  `signin.otherAccount` applies as to a code).

## 4. Server

**Package.** `@better-auth/passkey@1.7.5`, pinned to the server's `better-auth` 1.7.5. Its peers
(`better-call` 1.4.0, `@better-auth/utils` 0.4.2) are the ones the lockfile has. It brings
`@simplewebauthn/server` 13. Upgrading Better Auth is not part of this work.

**Relying party** (my call; the issue asked for it to be recorded here). A new setting `PASSKEY_RP_ID`:

| Deployment | RP ID | Expected origin |
|---|---|---|
| Production | `wordado.com` | `https://app.wordado.com` |
| Preview | its `workers.dev` hostname | the preview's `BASE_URL` |
| Local and tests | `localhost` | the dev server's origin |

`wordado.com`, the registrable domain, rather than `app.wordado.com`: a passkey made for it works on any
subdomain, so it survives a move of the app, and the native apps can later use the same passkeys through
associated domains served by the site at `wordado.com/.well-known/`. The expected origin is set from `BASE_URL`,
never read from the request's `Origin` header (the plugin's default). `rpName` is `Wordado`. Unset, the RP ID is
`BASE_URL`'s hostname, so the preview and local runs need no new variable; production sets it.

**Options.** Registration needs a session (`registration.requireSession`, the default), so a passkey can only be
added to an account that already exists. The plugin also wants a *fresh* session for it (Better Auth's
`freshAge`, one day): right after a code sign-in it is fresh; later, settings asks for a code first (§5.3).
`authenticatorSelection`: `residentKey: 'required'` and `userVerification: 'required'`, so the passkey is
discoverable (sign-in needs no email first) and always asks for the device unlock. No attestation.

*As built:* the plugin verifies responses with `requireUserVerification: false` whatever `authenticatorSelection`
says, so the server enforces the unlock itself: `afterVerification` hooks on registration and authentication refuse
a response without the user-verified flag (`USER_NOT_VERIFIED`), before a passkey is stored, a counter moved or a
session made (`requireUserVerification` in `server/src/auth.ts`). A registration on a session older than a day is
refused with 403 `SESSION_NOT_FRESH`.

**Endpoints.** The plugin's, under `/api/auth/passkey/`: generate and verify registration, generate and verify
authentication, list, delete. `update-passkey` (renaming) is turned off with `disabledPaths`, since nothing is
named.

**Rate limits.** In `customRules`, on the hashed store as today: `generate-authenticate-options` 60 a minute,
`verify-authentication` 10 a minute; `generate-register-options` and `verify-registration` 5 a minute. The
options were first set at 10 like the sign-ins; the build raised them to 60 because the email field's autofill
asks for options every time the sign-in screen opens, so 10 per shared address (a classroom, an office) would run
out before anyone signed in. Options are only a challenge; the verifications, which are the attempts, stay at 10.

**What is kept.** A migration adds the plugin's table `passkey`:

| Column | Kept | Why |
|---|---|---|
| `id`, `userId` (references `user`, `on delete cascade`) | yes | whose it is; erasure follows the user row |
| `credentialID`, `publicKey`, `counter` | yes | verifying a sign-in, and catching a cloned key |
| `createdAt` | yes | the settings list and the export |
| `transports` | yes | the plugin passes it back to the browser as a hint for where the key is (`internal`, `hybrid`, …); it names no device |
| `deviceType`, `backedUp` | yes | the plugin requires them; two flags (synced or single-device), nothing identifying |
| `name` | always null | no names (§3) |
| `aaguid` | always null | it identifies the authenticator's model, which the app never uses |

Better Auth's database hooks cover only its own tables, so a `before insert or update` trigger in the migration
sets `name` and `aaguid` to null, in the spirit of `withoutDevice` in `server/src/auth.ts`. The migration only
adds, so it works with the previous Worker (`docs/deploy.md`).

**Sign-in.** A passkey sign-in makes a session as a code does. The session hooks run, so the device is
stripped from it and the last sign-in is recorded (#187). The session lasts 60 days, as now.

**Erasure and export.** Deleting the account removes the passkeys through the cascade; `deletion.ts`'s comment
lists them. The export moves to `wordado-export-5` and gains `account.passkeys`: `[{ createdAt }]`, oldest first,
no key material.

## 5. The app

The browser side uses `@simplewebauthn/browser` (`startRegistration`, `startAuthentication`) behind the app's
own `httpApi`, not Better Auth's client. It is loaded only by the sign-in screen and the account settings, so the
first screen does not grow. Where `PublicKeyCredential` is missing, nothing about passkeys is shown.

### 5.1 The offer after a code sign-in

- **When.** After a sign-in with a code succeeds, for an existing account or a new one, once the account is
  ready and the demo's carry-over or discard has run. Not after a passkey sign-in.
- **Only if** the browser has a platform authenticator
  (`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`), and this device has not answered the
  offer before.
- **What.** A last step of the sign-in screen, with its own heading: *Sign in faster next time*, a line saying
  the device's fingerprint, face or PIN signs in instead of a code, and that nothing about the face or finger
  leaves the device. Two buttons: *Use a passkey* and *Not now*. A notice from the sign-in (the demo kept or
  discarded) is shown on the screen the learner lands on, as today, not lost to the offer.
- **Answer.** Either answer is recorded on the device (local storage, not synced) and the offer never shows
  there again. *Use a passkey* runs the registration; on success, a short confirmation, then on to where the
  sign-in was going. If the learner cancels the device prompt or it fails, the app says so in one line and goes
  on; it is not offered again. Settings remains the way back (§5.3).
- *As built:* the answer ends in a status line (*Passkey added. Next time, sign in with it.* or *The passkey was
  not added. You can add one in settings.*) and a *Continue* button, which takes focus and goes home; *Not now*
  goes home at once. The answer is the local-storage key `wordado.passkeyOffer`. The offer owed is kept outside
  the screen, because finishing the sign-in switches the database and remounts the app.

### 5.2 The sign-in screen

- **Button.** On the first step, below the email form, a secondary button *Sign in with a passkey*. It runs the
  authentication with no email: the passkey is discoverable. On success the sign-in finishes as a code one does,
  with the same rules for the demo and for another account's progress on the device. Under it, a note tied to the
  button (`aria-describedby`) says a passkey is added in Settings › Account after a code sign-in, and works only in
  the password manager that saved it (#308): a passkey made on one device is often missing on another, and the
  browser's "no passkey found" says nothing about why.
- **Autofill.** Where the browser supports conditional mediation
  (`PublicKeyCredential.isConditionalMediationAvailable()`), the email field gets `autocomplete="email webauthn"`
  and the screen starts a conditional authentication when it opens: the browser lists the learner's passkeys in
  the field's suggestions. It is cancelled when the learner goes on with the code.
- **Failures.** Cancelled by the learner: nothing is said. A passkey the server no longer knows (removed in
  settings, or from another deployment): *This passkey no longer works. Sign in with a code, then you can add a
  new one.* Rate limited or offline: the screen's existing messages.
- *As built:* these are the button's. The request waiting in the email field is silent about its own failures
  (no connection, options refused), since the learner has asked for nothing yet; it speaks only when the server
  refused a passkey the learner picked (not found, failed, or without the device unlock). Pressing the button
  aborts the waiting request first, and the wait starts again after a button attempt that did not sign in.

### 5.3 Settings › Account

- A *Passkeys* part under the email: each passkey as *Passkey added on {date}*, oldest first, with *Remove*.
- *Remove* asks once (*Remove this passkey? It will no longer sign you in.*), then deletes it. A line says the
  passkey also stays in the device's password manager until removed there. Where the browser supports the
  WebAuthn signal API, the app tells the device it is gone (`signalUnknownCredential`); elsewhere nothing
  more is done.
- *Add a passkey on this device*, shown when the browser has a platform authenticator. If the session is not
  fresh (the server refuses), the app says *For your safety, sign in again with a code to add a passkey* and
  offers the sign-in, which returns to Settings › Account when done (`/signin?back=account`, #302).
- Without passkeys: one line saying what a passkey is, and the add button.

## 6. Texts

New strings, in en, de, es and bg: the offer (heading, line, two buttons, confirmation, failure), the sign-in
button and its failure line, the settings part (heading, list item, remove, confirm, the password-manager line,
the add button, the fresh-session line, the empty line). de, es and bg follow the existing texts' style; they
wait for a native reader like the rest (#102).

## 7. Spec and privacy

- **App spec.** §8.6 gains the second way to sign in: what it is, what the server keeps (§4's table) and what it
  does not, and the offer. §11 adds passkeys to the export and the erasure.
- **Privacy policy** (site repository, four languages, with the notice mail the site's rules require for a
  change in what is collected): the server keeps, for each passkey the learner adds, a public key and its
  creation date; no biometric data, which never leaves the device. The policy changes before the feature is
  released to production.

## 8. Rollout

1. The migration and the server ship first, with the app's passkey parts in place. Nothing is shown until the
   browser supports it, so no flag is needed.
2. Production sets `PASSKEY_RP_ID=wordado.com` before that deployment (`docs/deploy.md` lists it).
3. The privacy policy and its notice go out on the site before or with the deployment (§7).

## 9. Tests

- **Server** (with a software authenticator from `@simplewebauthn/server`'s test helpers or a fixture):
  register after a code sign-in; refuse registration without a session or with a stale one; sign in with a
  passkey; a removed passkey no longer signs in; `name` and `aaguid` are null after register even when sent;
  `update-passkey` is not found; the rate limits; deleting the account removes the passkeys; the export lists
  them by date and holds no key material.
- **App (unit):** the offer shows once per device, only with a platform authenticator, not after a passkey
  sign-in, and after the demo's notice is kept; the sign-in button and its failures; the settings list, removal
  and the fresh-session message; nothing about passkeys without `PublicKeyCredential`.
- **Browser:** with Playwright's virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`, Chromium only):
  sign in with a code, take the offer, sign out, sign back in with the passkey; remove it in settings and see it
  refused. It needs the real server, so it lives in `accounts.spec.ts` and runs in CI.

## 10. Left to the builder

- The exact component and file layout, and where the browser module is split off.
- The trigger's form, and the migration's number.
- The wording of the strings, within §5 and §6.
- Whether the settings list shows the passkey's date only, or the date and time when two were added the same
  day.
