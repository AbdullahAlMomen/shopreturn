# ShopReturn self-signup settings

Project: `Df53833214f2a4243b696b55040b32509` (ShopReturn, dev)
Changed: 2026-09-14

## ⚠️ Critical finding: activation needs an app route that may not exist yet

The activation email IAM sends does **not** link to the IdP — it links into the
**scaffolded app's own domain**:

```
https://dbzjdy.slsblx.com/activate?code=<code>&lang=<locale>
```

(observed live: `https://dbzjdy.slsblx.com/activate?code=a347e8a9170446eea49d9c51b8015005&lang=en-US`)

So the app itself must implement an `/activate` route that reads `code` (and
tolerates the `lang` query param it's sent alongside) and calls IAM directly:

- `blocksClient.auth.validateActivation({ ActivationCode: code })` — optional
  pre-check a well-built page would call before committing (see field-name note
  below; `code` alone was rejected here).
- `blocksClient.auth.activate({ code })` — the call that actually flips the
  account to `active: true, isVerified: true`.

**Neither call requires an authenticated session** (`auth: false` in the SDK) —
this is deliberate, since the visitor clicking the link isn't logged in yet.

**Whether `blocks new web` scaffolds this route is unverified.** This task did
not check the scaffolded app for an `/activate` page. If it's absent, every
self-registered customer clicks their activation link, lands on a 404, and the
account is permanently stuck `active: false` (there is no other way to trigger
`auth.activate()` from the browser). **The next task must check for this route
and build it if missing** — this is arguably the single most important
customer-facing gap in the signup flow, ahead of the mail-delivery-visibility
question this task also ran into.

## ⚠️ Second finding: signup's `password` field appears not to be bound at all

Two throwaway probe signups (`shopreturn-selfreg-probe1@yopmail.com` with no
password field, and `...-probe2@yopmail.com` with `password: 12345`, a wrong
type) both returned `isSuccess: true` with **no validation error concerning
password at all** — only `email` is enforced as required
(`{"errors": {"Email": "Email is required."}}` on an empty body). A DTO that
actually binds and validates a password would reject a numeric value or at
minimum flag a missing one under some complexity/required rule. The absence of
any such error strongly suggests **the `password`/`confirmPassword` keys this
task guessed are not real fields on IAM's signup payload** — they were silently
ignored, .NET-style, as unrecognized JSON properties.

This is consistent with the observed symptom: after a real activation
succeeded (`active: true, isVerified: true`, confirmed below), `signIn()` with
the password generated and passed at signup time still failed with
`invalid_username_password`. The customer's real password-setting step is
evidently **not** part of `auth.signup()` — it likely belongs to a separate
flow (candidates in the SDK: `auth.resetPassword({ Code, ... })`, which is
`Code`-gated the same way activation is, or a password-set step folded into
whatever the real `/activate` page does). **This needs a follow-up task**; it
was not chased further here per the explicit instruction to stop and report
once activation succeeds but login still fails.

## Starting state

```
blocks iam signup-settings get --project Df53833214f2a4243b696b55040b32509 --account default --json
```

```json
{
  "isSignUpEnable": false,
  "isEmailPasswordSignUpEnabled": false,
  "isSSoSignUpEnabled": false,
  "defaultRolesForNewUser": [],
  "defaultPermissionsForNewUser": []
}
```

## What was enabled, and the master-toggle gap

`blocks iam signup-settings save` reads current settings and merges — it does not
replace the document. Its flag surface (`--email-password-signup`,
`--default-roles`) only ever writes `isEmailPasswordSignUpEnabled`,
`isSSoSignUpEnabled`, `defaultRolesForNewUserOnSignUp` and
`defaultPermissionsForNewUserOnSignUp`. A dry-run with flags alone confirmed this
directly — `isSignUpEnable`, the master toggle, is **absent** from the request
body the CLI would send:

```bash
blocks iam signup-settings save --email-password-signup --default-roles customer \
  --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

```json
{
  "dryRun": true,
  "endpoint": "/iam/v4/iam/signup-settings",
  "request": {
    "isEmailPasswordSignUpEnabled": true,
    "isSSoSignUpEnabled": false,
    "defaultRolesForNewUserOnSignUp": ["customer"],
    "defaultPermissionsForNewUserOnSignUp": []
  }
}
```

Since `isSignUpEnable` was already `false` and nothing in the flag set could
change it, applying just the flags would have left self-signup globally
disabled regardless of the per-method toggle. **`--body` was required** to merge
the master toggle into the same request:

```bash
blocks iam signup-settings save --email-password-signup --default-roles customer \
  --body '{"isSignUpEnable": true}' \
  --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

confirmed `isSignUpEnable: true` now present in `request` alongside the flag-derived
fields, and this exact command was then re-run with `--yes` in place of
`--dry-run` (response: `{"itemId": "4567d527-d7fd-4b91-b120-9f2ea5a697f4", "errors": null, "isSuccess": true}`).

## Resulting state (read back)

```json
{
  "isSignUpEnable": true,
  "isEmailPasswordSignUpEnabled": true,
  "isSSoSignUpEnabled": false,
  "defaultRolesForNewUser": ["customer"],
  "defaultPermissionsForNewUser": []
}
```

SSO signup stays off (out of scope for ShopReturn); email/password signup is on;
every self-registered user defaults into the `customer` role from
`blocks/iam/roles.md`, with no additional permissions.

## Proof: a real stranger self-registered

Settings reading back correctly is not proof signup works — every user before
this task was admin-created and admin-activated, a path no real customer takes.
`tools/access-check/signup-check.mjs` calls `blocksClient.auth.signup(...)`
(`POST /iam/v4/auth/signup`, unauthenticated) directly, the same surface a
public signup form would use.

The SDK's `signup(request: Record<string, unknown>)` passes the body through
unchanged — IAM owns the payload shape, not the SDK. Unlike `login`, which
needs `{username, password}`, the first-guess signup payload (email, username,
password, confirmPassword, firstName, lastName) was **accepted on the first
attempt** — no rejection/error-message round trip was needed:

```json
{
  "itemId": "caf9455e-365b-4c73-9034-f559cf36f00e",
  "isSuccess": true,
  "errors": null,
  "organizationId": null,
  "organizationNameSuggestions": []
}
```

Registered: `shopreturn-selfreg@yopmail.com` (password generated, stored only in
`tools/access-check/.env` under `SHOPRETURN_SELFREG_EMAIL` /
`SHOPRETURN_SELFREG_PASSWORD` — key names only, no values, added to
`.env.example`).

Reading the new account back immediately after signup confirmed it landed with
the `customer` default role, unverified and inactive pending activation —
exactly the shape a real signup should produce:

```json
{
  "active": false,
  "isVerified": false,
  "roles": { "default": ["customer"] }
}
```

## Activation: mail delivery confirmed by direct human inspection; API activation completed

Two automated routes were tried first to locate the activation message:

1. **`blocks mail mailbox list --project ... --search shopreturn-selfreg --json`**
   — `{"totalCount": 0, "mails": [], "isSuccess": true}`, unfiltered and
   filtered. Blocks Mail's tracked mailbox has no record of this message —
   IAM's signup/activation email does not route through this project's tracked
   Blocks Mail outbox.
2. **yopmail inbox** via `WebFetch` at `https://yopmail.com/en/wm` — returned
   only the generic JS-rendered landing shell, no message content, consistent
   with this route's known prior resistance to `WebFetch` elsewhere in this
   project.

Neither automated route surfaced the mail. **A human then checked yopmail
directly in a browser and confirmed the mail arrived**: sender
`Selise Blocks <blocks@selise.io>`, subject "Welcome to Blocks Construct",
containing the activation link quoted at the top of this document.

Activation was then completed the way the `/activate` page is expected to,
using `tools/access-check/activate-check.mjs <code>`:

- `validateActivation({ code })` — **rejected**: `{"status": "Invalid",
  "errors": {"ActivationCode": "ActivationCode_Required"}, "isSuccess": false}`.
  The field name is `ActivationCode`, not `code` — `validateActivation` was not
  retried with the corrected name since `activate` (below) already completed
  the account with the code key it does accept, and the task's stop condition
  was reached; the exact accepted field name for `validateActivation` remains
  unconfirmed.
- `activate({ code })` — **accepted**: `{"itemId": null, "isSuccess": true,
  "errors": {}, "organizationId": null, "organizationNameSuggestions": []}`.

Confirmed by re-reading the user immediately after:

```json
{
  "active": true,
  "status": 1,
  "isVerified": true,
  "roles": { "default": ["customer"] }
}
```

`blocks iam users activate` was **not** used at any point for this account —
only the public, unauthenticated `activate` SDK call with the code from the
real email.

## Login after activation: fails — unresolved, stopped per instruction

`signIn()` with the email/password used at signup time fails even though the
account is now active and verified:

```
login for shopreturn-selfreg@yopmail.com returned no access token:
{"error":"invalid_username_password","error_description":"Invalid username or password","redirect_url":null}
```

See the "signup's `password` field appears not to be bound at all" finding
above for why: two probe signups strongly suggest `auth.signup()` never
actually stored the password this task supplied. Per instructions, this was
not chased further — it is reported here as an open item for the next task,
not silently worked around.

## End-to-end customer journey, as verified in this session

1. Admin enables signup settings (`isSignUpEnable`, `isEmailPasswordSignUpEnabled`,
   default role `customer`) — **done and verified**.
2. A stranger submits `POST /iam/v4/auth/signup` (email + guessed password
   fields + name) — **works**; account created with `active: false,
   isVerified: false`, `roles.default: ["customer"]`.
3. IAM sends an activation email from `blocks@selise.io`, subject "Welcome to
   Blocks Construct", linking to
   `https://dbzjdy.slsblx.com/activate?code=<code>&lang=<locale>` — **confirmed
   delivered** (by direct human inspection of yopmail; not observable through
   Blocks Mail's tracked mailbox or through automated yopmail access in this
   session).
4. The customer clicks the link, landing on the **app's own domain** — this
   presumes an `/activate` route exists in the scaffolded app to receive
   `code`/`lang` and call IAM. **Whether that route exists is unverified.**
5. That route calls `auth.activate({ code })` (optionally preceded by
   `auth.validateActivation({ ActivationCode: code })`) — **confirmed working**
   against the real code from the real email; the account flips to
   `active: true, isVerified: true` with no admin action.
6. The customer logs in via `auth.login({ username, password })` — **fails**
   for this account with `invalid_username_password`, most likely because the
   password supplied at signup was never actually persisted by IAM (see
   finding above). Root cause and correct fix are open.

**Bottom line:** every leg except the last is now proven working end to end,
including real mail delivery and real code-based activation with no admin
shortcut. Two concrete gaps remain for follow-up: (a) confirm/build the app's
`/activate` route, since nothing today proves the scaffolded app can receive
this link at all; (b) find the correct way for a self-registered customer to
end up with a working password — signup's password fields appear to be
silently ignored by IAM.
