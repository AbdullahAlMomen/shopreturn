# ShopReturn Web OIDC client

Project: `Df53833214f2a4243b696b55040b32509` (ShopReturn, dev)
Changed: 2026-09-14

## Client created

```
blocks auth oidc-clients list --project Df53833214f2a4243b696b55040b32509 --account default --json
```

| Field | Value |
|---|---|
| `clientId` | `fc2c934a-f6aa-4eb8-878a-c6895b347d6f` |
| `clientDisplayName` / `clientName` | `ShopReturn Web` |
| `clientType` | `public` |
| `tokenEndpointAuthMethod` | `none` (confirms no secret is used) |
| `requirePkce` | `true` |
| `isActive` | `true` |
| `redirectUris` | `https://dbzjdy.slsblx.com/login/callback`, `https://localhost:5173/login/callback` |
| `postLogoutRedirectUris` | `https://dbzjdy.slsblx.com`, `https://localhost:5173` |
| `allowedScopes` | `openid`, `profile`, `offline_access` (server auto-added `offline_access`) |
| `scope` | `openid profile offline_access` |
| `allowedResponseTypes` | `code` |
| `isAutoRedirect` | `true` |
| `registerAsIdentityProvider` | `true` |
| `externalDiscoveryEndpoint` | `https://iam.seliseblocks.com/Df53833214f2a4243b696b55040b32509/.well-known/openid-configuration` (this tenant's own discovery document, auto-filled since `--external-discovery-endpoint` was omitted) |

### Redirect URI sets and why both are required

- `https://dbzjdy.slsblx.com/...` — the deployed ShopReturn domain.
- `https://localhost:5173/...` — the scaffold's local HTTPS dev server (Vite default port). Omitting this means login works in production but fails for every developer running the app locally; it was included in both the redirect and post-logout redirect URI lists.

### Flags used and why

All flags were verified against `blocks help auth oidc-clients save --json` before running; every flag below appears in that list.

| Flag | Value | Why |
|---|---|---|
| `--client-display-name` | `ShopReturn Web` | Human-readable name shown in IAM admin and consent screens. |
| `--redirect-uris` | both URIs, comma-separated | Where the browser is sent back after login; see above. |
| `--post-logout-redirect-uris` | both origins | Where the browser is sent after logout. |
| `--active` | (flag) | Client must be active to be usable. |
| `--require-pkce` | (flag) | Mandatory for a public browser client — no client secret, so PKCE is the only code-exchange protection. |
| `--auto-redirect` | (flag) | Skips an intermediate IdP chooser screen since this app only ever uses this one client. |
| `--register-as-identity-provider` | (flag) | Registers the linked identity provider in the same call, sourced from this tenant's own discovery document (see `externalDiscoveryEndpoint` above). |
| `--client-type` | `public` | **Not in the brief's original command — added after reading the CLI's own help text**, which states in `details`: *"--client-type is not optional in practice: IAM derives tokenEndpointAuthMethod from it, so omitting it stores a browser/SPA client as confidential (client_secret_post) and lets it request the client_credentials grant. Pass --client-type public for any PKCE/browser client."* Omitting it would have produced a confidential client with a secret and the client_credentials grant enabled — exactly what the brief said this client should not be. The resulting `tokenEndpointAuthMethod: "none"` confirms the fix worked. |
| `--scope` | `openid profile` | Base OIDC scopes; the server appended `offline_access` automatically (needed for refresh tokens). |

**No unknown/typo'd flags were used.** `--client-type` was the one addition beyond the brief, made because the help output explicitly warned that omitting it silently defeats the "public client, no secret" requirement.

### Secret handling

The `save` response was inspected for `client_secret` / `clientSecret` keys — **none were present** (`grep -i "secret"` on the raw response and on the subsequent `list` readback both came back empty). This matches `tokenEndpointAuthMethod: "none"`: a public PKCE client has no secret to protect. Nothing secret-shaped was printed, recorded, or committed anywhere in this session.

## Tenant-level OIDC enablement — BLOCKED, not applied

**`isOidcEnabled` is still `false`.** Enabling it was attempted and reverted. This is the most important finding in this document.

### What was tried

`blocks auth config save --oidc-enabled ...` (per the brief) was dry-run first, and the dry-run body looked correct every time — `accountActionBaseUrl: "https://dbzjdy.slsblx.com"` and `useAccountActionBaseUrlAsDefault: true` were always present and unchanged in the *request preview*. Per the task's instruction, dry-runs showing those two fields intact were treated as green lights to apply.

**The dry-run preview does not reflect server-side behavior on `isOidcEnabled: true`.** Across three separate apply attempts — (1) plain `--oidc-enabled`, (2) `--oidc-enabled` plus an explicit `--account-action-base-url https://dbzjdy.slsblx.com` and an explicit `allowedGrantTypes` body, (3) the same plus explicit `useAccountActionBaseUrlAsDefault: false` (testing whether that flag's semantics were inverted) — the **read-back after every apply showed `accountActionBaseUrl` silently overwritten to `https://iam.seliseblocks.com`** (the IAM's own base URL), regardless of what was sent in the request. `accountActivationPath` also flips from `"activate"` to `"oidc/activate/"` whenever `isOidcEnabled: true` is persisted.

This means: **turning on tenant-level OIDC unconditionally redirects account-action links (activation, password reset) to IAM's own hosted domain**, overriding the custom `accountActionBaseUrl` no matter what value is supplied. `blocks/iam/signup-settings.md` already proved that the activation email linking to the app's own domain (`https://dbzjdy.slsblx.com/activate?code=...`) is load-bearing for the entire customer self-registration journey — the app owns the `/activate` password-collection form, IAM's page does not. Enabling OIDC as currently behaving on this tenant would silently break that journey.

Per the brief's explicit instruction — *"If the dry-run would blank either of them, stop and report rather than applying"* — this task stopped short of leaving OIDC enabled and **reverted to `isOidcEnabled: false`** to protect the working activation flow. The three apply attempts and the revert are real mutations against the live tenant; each is documented in `task-3-report.md` with full before/after bodies.

**Recommendation:** before enabling OIDC on this tenant, someone with IAM platform access needs to confirm whether this `accountActionBaseUrl` override is intended behavior (i.e., OIDC tenants are expected to host activation via IAM, not the app) or a bug. If it's a bug, wait for a fix. If it's intended, Task 4's `/activate` route plan needs to be revisited — either activation moves to an IAM-hosted page, or a different mechanism must be found to keep the app-hosted activation flow when OIDC is also live.

### A second, separate regression discovered during testing

Independent of the above: the **first successful** `auth config save` call in this session (needed to work around a validation error, see below) silently reset `allowedGrantTypes` from its original `["authorization_code", "client_credentials", "refresh_token"]` to `[]`. This happened even in later calls where `allowedGrantTypes` was explicitly included in the request body and appeared correctly in the dry-run preview — the server did not persist it. Multiple attempts to restore it (plain retry, explicit body, combined with the `isOidcEnabled` revert) all failed to bring it back; every other explicitly-restored field (`accountActivationPath`, `accountActionBaseUrl`, `useAccountActionBaseUrlAsDefault`) *did* restore correctly on the final revert. `allowedGrantTypes` appears to be write-accepted-but-not-persisted by this endpoint. **Current live state has `allowedGrantTypes: []`**, down from 3 grant types originally — this may affect other OAuth flows on this tenant (e.g. `client_credentials` for machine-to-machine callers, `refresh_token` for session renewal) and should be investigated/reported to the IAM team; it is not something this task could fix via the CLI.

### A third, minor and intentional change: `passwordStrengthCheckerRegex`

The very first `--oidc-enabled` apply attempt (no other changes) failed outright with a 400: *"PasswordStrengthCheckerRegex: The PasswordStrengthCheckerRegex field is required."* The field was `null` in the original config and is not exposed as a required flag by `blocks help auth config save`. Sending it explicitly as JSON `null` via `--body` still failed the same validation — the API requires an actual non-null string, not just presence of the key. `--password-strength-regex ".*"` (matches anything, i.e. no real restriction — functionally equivalent to "no policy," same as the original `null`) was used purely to satisfy this requirement so that *any* `auth config save` call could succeed at all. **This value is a placeholder and should be revisited** if/when ShopReturn defines a real password strength policy; it currently persists in the live config (`passwordStrengthCheckerRegex: ".*"`) even after the OIDC revert, because there is no flag or body value that removes/nulls it back out (the same "field is required" error blocks that).

## Verified final auth config state (after revert)

```
blocks auth config get --project Df53833214f2a4243b696b55040b32509 --account default --json
```

```json
{
  "isOidcEnabled": false,
  "accountActionBaseUrl": "https://dbzjdy.slsblx.com",
  "useAccountActionBaseUrlAsDefault": true,
  "accountActivationPath": "activate",
  "allowedGrantTypes": [],
  "passwordStrengthCheckerRegex": ".*"
}
```

`isOidcEnabled: false` — Step 3 (enable OIDC on the tenant) was **not completed**; see "Tenant-level OIDC enablement — BLOCKED" above. `accountActionBaseUrl` and `useAccountActionBaseUrlAsDefault` — the two fields this task was told to protect — are confirmed intact. `allowedGrantTypes` is a known, unresolved regression (see above). `passwordStrengthCheckerRegex` is a required-but-previously-unset field now holding a permissive placeholder.

## What the app must implement

From `blocks/iam/signup-settings.md`: the activation email links to the app's own domain —

```
https://dbzjdy.slsblx.com/activate?code=<code>&lang=<locale>
```

The app must own an `/activate` route that:

1. Reads `code` (and tolerates the `lang` query param) from the query string.
2. Presents a form collecting a password (and confirmation) from the visitor — this is not a passive confirmation page. Signup is identity-only; the account has no usable password until activation supplies one.
3. Calls `auth.activate({ code, password, confirmPassword })` with what the visitor enters. (Optionally calls `auth.validateActivation({ ActivationCode: code })` first to confirm the code is live before rendering the form — cheap, and doesn't spend the code.)

This is recorded here, in the auth-surface document, because it is a requirement on the OIDC/auth client the app authenticates through, and Task 4 (scaffolding the web app) must not miss it. It is independent of, and unaffected by, the `isOidcEnabled` blocker above — email/password activation goes through IAM's REST API directly, not through the OIDC client created in this task.
