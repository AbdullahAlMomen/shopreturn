# ShopReturn self-signup settings

Project: `Df53833214f2a4243b696b55040b32509` (ShopReturn, dev)
Changed: 2026-09-14

## The customer journey, definitively resolved

Enable signup settings (admin, one-time) → stranger calls `auth.signup()`
(identity only, no usable password yet) → IAM mails an activation link → the
activation page **collects a password from the visitor** and submits it
together with the code → account becomes active **and** gets a working
password → `auth.login()` works.

### Where the activation page lives depends on `isOidcEnabled` — read this first

This changed mid-project and the distinction is easy to get wrong.

| `isOidcEnabled` | `accountActionBaseUrl` | `accountActivationPath` | Activation link | Who hosts the page |
|---|---|---|---|---|
| `false` | `https://dbzjdy.slsblx.com` | `activate` | `https://dbzjdy.slsblx.com/activate?code=…&lang=…` | **your app** — you must build the route |
| `true` (current) | `https://iam.seliseblocks.com` | `oidc/activate/` | `https://iam.seliseblocks.com/oidc/activate/?code=…` | **the IdP** — nothing to build |

**The project is currently `isOidcEnabled: true`**, set as a side effect of
`blocks new web`, which rewrites all three fields above. So activation is
IdP-hosted and **the app needs no `/activate` route.** Confirmed by a human
completing activation through `https://iam.seliseblocks.com/oidc/activate/?code=…`
and logging in afterwards.

Turning OIDC back off would move activation to the app domain and make that
route mandatory again — every self-registered customer would otherwise land on
a 404 holding an account they can never use.

The strongest evidence for password-at-activation is
`shopreturn-selfreg-probe1@yopmail.com`: it was created by a *probe* signup
with a deliberately invalid password, and still ended up with a working login
purely through the activation flow. The password is established at activation.
It is never established at signup.

This was proven end to end with a second throwaway account
(`shopreturn-selfreg2@yopmail.com`) after the first account
(`shopreturn-selfreg@yopmail.com`) showed activation-without-password
succeeds but leaves the customer unable to log in. `blocks iam users activate`
was never used for either account — every step below is the real,
unauthenticated public API surface a browser would call.

### Exact payload shapes (three different endpoints, three different shapes)

| Endpoint | Request body that works | Notes |
|---|---|---|
| `POST /iam/v4/auth/signup` | `{ email, username, password, confirmPassword, firstName, lastName }` | Only `email` is actually validated/required (`{"errors":{"Email":"Email is required."}}` on `{}`). Two probe signups — one with no password field, one with `password: 12345` (wrong type) — both returned `isSuccess: true` with **zero** password-related errors, proving `password`/`confirmPassword` here are silently discarded. Signup is identity-only. |
| `POST /iam/v4/auth/validate-activation` | `{ ActivationCode: code }` | **PascalCase**, not `code`. `{ code }` is rejected: `{"status":"Invalid","errors":{"ActivationCode":"ActivationCode_Required"},"isSuccess":false}`. Confirmed working shape returns `{ userId, firstName, lastName, status: "Valid", errors: null, isSuccess: true }` — it does **not** hint at a password field either way; it's a pure code-validity check. |
| `POST /iam/v4/auth/activate` | `{ code, password, confirmPassword }` | **lowercase `code`**, unlike `validate-activation`'s `ActivationCode` — a real casing/naming inconsistency between two endpoints in the same activation flow, worth flagging to the IAM team. Confirmed live: this shape both activates the account (`active: true, isVerified: true`) **and** sets a password that `auth.login()` subsequently accepts. |
| `POST /iam/v4/auth/login` | `{ username, password }` | Unchanged from `client.mjs`; now succeeds for a self-registered, self-activated customer. |

None of `signup`, `validate-activation`, or `activate` require an authenticated
session (`auth: false` in the SDK) — correct, since the visitor isn't logged in
at any of these steps.

### Evidence trail (two accounts)

**Account 1 — `shopreturn-selfreg@yopmail.com`** (activation code
`a347e8a9...`, now spent): signup succeeded → real activation mail confirmed
delivered by a human reading yopmail directly (automated routes below found
nothing) → `activate({ code })` (no password) succeeded, account flipped to
`active: true, isVerified: true` → `auth.login()` with the signup-time
password **failed** (`invalid_username_password`). This is what first exposed
that signup's password fields are inert.

**Account 2 — `shopreturn-selfreg2@yopmail.com`** (activation code
`2f913c12...`, now spent): signup succeeded, same shape → before spending the
fresh code, `validateActivation({ ActivationCode: code })` was called first
and returned `status: "Valid"` (the code was confirmed live and unspent
without risking it on a wrong `activate` payload) → `activate({ code,
password, confirmPassword })` on the **first and only** real attempt
succeeded → user read back as `active: true, isVerified: true` → `auth.login()`
**succeeded** (token returned; length only, never printed). This confirms
password-on-activate is the real, complete mechanism.

### Two automated mail-discovery routes were tried and found nothing (for account 1)

1. `blocks mail mailbox list --project ... --search shopreturn-selfreg --json`
   → `{"totalCount": 0, "mails": [], "isSuccess": true}`, filtered and
   unfiltered. IAM's activation email does not route through this project's
   tracked Blocks Mail outbox.
2. `WebFetch` on the yopmail inbox (`https://yopmail.com/en/wm`) → only the
   generic JS-rendered landing shell, no message content — consistent with
   yopmail's known prior resistance to `WebFetch` elsewhere in this project.

Both activation codes used in this document were read out of yopmail by a
human directly, not by any tool available in this session.

## ⚠️ Remaining unverified gap: does the scaffolded app have an `/activate` route?

The activation email links to the **app's own domain**, not the IdP:

```
https://dbzjdy.slsblx.com/activate?code=<code>&lang=<locale>
```

So the app itself — not IAM, not the CLI — must own an `/activate` route that:

1. Reads `code` (and tolerates the `lang` query param sent alongside it) from
   the query string.
2. Presents a "choose your password" form (per the resolved journey above —
   this is not just a confirmation page).
3. Calls `auth.activate({ code, password, confirmPassword })` with what the
   visitor enters.
4. Optionally calls `auth.validateActivation({ ActivationCode: code })` first
   to confirm the code is live before rendering the password form — cheap and
   doesn't spend anything.

**Whether `blocks new web` scaffolds this route is still unverified** — this
task exercised the API directly and never checked the scaffolded frontend.
If the route is absent, every real signup dead-ends at a 404 and the account
is permanently stuck `active: false` (there is no other way to reach
`auth.activate()` from a browser). **This is the one remaining blocker for a
working customer self-registration demo** and should be the first thing the
next task checks.

## Signup settings change

### Starting state

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

### The master-toggle gap

`blocks iam signup-settings save` reads current settings and merges — it does
not replace the document. Its flag surface (`--email-password-signup`,
`--default-roles`) only ever writes `isEmailPasswordSignUpEnabled`,
`isSSoSignUpEnabled`, `defaultRolesForNewUserOnSignUp` and
`defaultPermissionsForNewUserOnSignUp`. A dry-run with flags alone confirmed
this directly — `isSignUpEnable`, the master toggle, is **absent** from the
request body the CLI would send:

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
disabled regardless of the per-method toggle. **`--body` was required** to
merge the master toggle into the same request:

```bash
blocks iam signup-settings save --email-password-signup --default-roles customer \
  --body '{"isSignUpEnable": true}' \
  --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

confirmed `isSignUpEnable: true` now present in `request` alongside the
flag-derived fields, and this exact command was then re-run with `--yes` in
place of `--dry-run` (response: `{"itemId": "4567d527-d7fd-4b91-b120-9f2ea5a697f4",
"errors": null, "isSuccess": true}`).

### Resulting state (read back)

```json
{
  "isSignUpEnable": true,
  "isEmailPasswordSignUpEnabled": true,
  "isSSoSignUpEnabled": false,
  "defaultRolesForNewUser": ["customer"],
  "defaultPermissionsForNewUser": []
}
```

SSO signup stays off (out of scope for ShopReturn); email/password signup is
on; every self-registered user defaults into the `customer` role from
`blocks/iam/roles.md`, with no additional permissions.

## Test accounts created in this investigation

Both are throwaway accounts created solely to prove the signup/activation/
login mechanics; neither is a fixture used by `tools/access-check/assertions.mjs`
or `seed.mjs`.

| email | purpose | final state |
|---|---|---|
| `shopreturn-selfreg@yopmail.com` | First proof: signup works, activation-without-password leaves login broken | `active: true, isVerified: true`, password **not** usable for login |
| `shopreturn-selfreg2@yopmail.com` | Second proof: activation-with-password fixes login | `active: true, isVerified: true`, password confirmed usable — `auth.login()` succeeds |

Credentials for both live only in `tools/access-check/.env`
(`SHOPRETURN_SELFREG_EMAIL`/`_PASSWORD`, `SHOPRETURN_SELFREG2_EMAIL`/`_PASSWORD`),
gitignored; key names only were added to `.env.example`.

## Scripts

- `tools/access-check/signup-check.mjs` — calls `auth.signup()` with the
  confirmed-working shape.
- `tools/access-check/activate-check.mjs <code>` — calls
  `validateActivation({ code })` (the wrong, pre-fix shape — kept as-is since
  it documents the casing mismatch) then `activate({ code })` (no password —
  reflects the account-1 investigation) then attempts `signIn()`. Superseded
  for the resolved journey by the payload table above; not modified further
  since it already serves as evidence of the failure mode that led to the fix.
