# ShopReturn access-check test users

Four fixture users, one per role, created for the access-enforcement proof in
`tools/access-check/`. Passwords are never recorded here — see
`tools/access-check/.env` (gitignored, not committed).

Project: `Df53833214f2a4243b696b55040b32509` (ShopReturn, dev)
Created: 2026-09-14

| email | role slug | itemId | purpose |
|---|---|---|---|
| `shopreturn-customer-a@yopmail.com` | `customer` | `28412829-9537-46e0-89b0-e458d46a375d` | Customer session A — used to prove a customer can only see their own returns, and as the "other customer" baseline against customer B for cross-tenant isolation checks. |
| `shopreturn-customer-b@yopmail.com` | `customer` | `66c47906-3c59-4d7d-8d49-2aa9afc60b4a` | Customer session B — paired with customer A to prove one customer cannot read or act on another customer's return. |
| `shopreturn-ops@yopmail.com` | `ops` | `539214ed-adc6-4adf-b233-f20f15349fc9` | Ops session — proves ops can receive, inspect and decide returns, and cannot reach manager-only analytics/financial views. |
| `shopreturn-manager@yopmail.com` | `manager` | `3fdf4a94-d418-474b-84ae-75c7eff63cb0` | Manager session — proves access to pattern views, financial totals and the decision log per the grant matrix in `blocks/iam/roles.md`. |

Addresses use `@yopmail.com` (a public disposable-inbox service) rather than
`@example.com` so activation mail, if IAM sends any, is actually readable at
https://yopmail.com/en/wm during debugging.

## Activation was required

`blocks iam users create` produces accounts with `active: false` and
`isVerified: false`. Login fails (`invalid_username_password`, a generic
credential-rejection error — not an activation-specific one) until the account
is explicitly activated. Each of the four users above was activated with:

```
blocks iam users activate <itemId> --reason "ShopReturn access-check test fixture" \
  --project Df53833214f2a4243b696b55040b32509 --account default --yes --json
```

`activate` sets **both** `active: true` and `isVerified: true` in one call —
confirmed by re-reading each user with `blocks iam users get <itemId>` before
and after. This bypasses the project's email/mail-link activation flow, which
is deliberate for fixtures: the CLI path is deterministic, reversible, and
doesn't depend on mail delivery timing. It is not a substitute for testing the
project's real self-signup/activation-by-email flow — that stays out of scope
here since `iam signup-settings` has `isSignUpEnable: false` and
`isEmailPasswordSignUpEnabled: false` project-wide (self-signup is off), and
real-signup activation belongs in a later plan, not with fixtures.

## These are test fixtures

Do not use these accounts for anything beyond the access-enforcement proof.
The Blocks CLI has no user-delete — `iam users deactivate <itemId>` is the off
switch. Deactivate all four before any production use of this project:

```
blocks iam users deactivate <itemId> --project Df53833214f2a4243b696b55040b32509 --account default --yes --json
```
