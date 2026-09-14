# ShopReturn self-signup settings

Project: `Df53833214f2a4243b696b55040b32509` (ShopReturn, dev)
Changed: 2026-09-14

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

Reading the new account back confirms it landed with the `customer` default role,
unverified and inactive pending activation — exactly the shape a real signup
should produce:

```bash
blocks iam users list --email shopreturn-selfreg@yopmail.com \
  --project Df53833214f2a4243b696b55040b32509 --account default --json
```

```json
{
  "active": false,
  "isVerified": false,
  "roles": { "default": ["customer"] }
}
```

## Activation mail: not confirmed delivered

Two routes were tried to find the activation message, in order:

1. **`blocks mail mailbox list --project ... --search shopreturn-selfreg --json`**
   — `{"totalCount": 0, "mails": [], "isSuccess": true}`, both unfiltered and
   filtered by search term. Blocks Mail's tracked mailbox has no record of any
   message to this address. This does not necessarily mean IAM sent nothing —
   IAM's signup/activation email may not route through this project's tracked
   Blocks Mail outbox at all — but it means this route provides no evidence
   either way.
2. **yopmail inbox** at `https://yopmail.com/en/wm`, local part
   `shopreturn-selfreg`. As flagged going in, the inbox is JS-rendered;
   `WebFetch` returned only the generic YOPmail landing shell (no message list)
   for both a direct query-string URL and the bare `/en/wm` path. This matches
   the known prior resistance to WebFetch elsewhere in this project and was not
   worth burning further attempts on URL variations.

**No activation link was found by either route**, so per the task's explicit
instruction, activation was **not** completed and `blocks iam users activate`
was **not** run on this account. `shopreturn-selfreg@yopmail.com` remains
`active: false, isVerified: false` in IAM, and `signIn()` for this user was not
attempted (a pending-activation account is expected to fail login, and there is
no admin-activation shortcut to legitimately unblock it here without
undermining the point of this test).

## End-to-end customer journey, as it stands today

1. A stranger submits `POST /iam/v4/auth/signup` with email/username/password
   (+name fields) — **works**, confirmed live. The account is created with the
   `customer` role already attached, `active: false`, `isVerified: false`.
2. IAM is expected to send an activation email. **Not confirmed** — it does not
   appear in this project's Blocks Mail tracked mailbox, and the yopmail inbox
   could not be inspected through the available tooling.
3. Clicking the activation link is expected to flip the account to
   `active: true, isVerified: true` without any admin action, per IAM's
   `POST /iam/v4/auth/activate` / `validate-activation` endpoints. **Not
   verified** — no link was in hand to follow.
4. Only after activation would `signIn()` succeed for a self-registered
   customer. **Not verified**, blocked on step 2/3.

**Bottom line:** self-signup itself is proven working end-to-end through account
creation with the correct default role. The activation-by-email leg of the
customer journey is unverified with the tools available in this session — this
is either a mail-delivery/configuration gap on this project, or simply a
delivery route this session could not observe (yopmail's JS inbox). Either way,
it should not be treated as working until someone with a working yopmail
viewer (or direct SMTP log access) confirms the link actually arrives and
completes activation without `iam users activate`.
