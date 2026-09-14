# ShopReturn Customer Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real customer can register themselves, sign in to the scaffolded ShopReturn app, and see only their own returns — with the write-side ownership hole closed and proven closed.

**Architecture:** Extends the existing `tools/access-check` suite with a seventh assertion covering write-side ownership forgery, closes that gap in `blocks/data/rules.json`, enables email/password self-signup with `customer` as the default role, provisions an OIDC client, and scaffolds the Vite/React app with `blocks new web`.

**Tech Stack:** `@seliseblocks/cli-os` 0.5.0, `@seliseblocks/client` 0.2.0, Vite + React (from the scaffold), Node 20+.

**Spec:** `docs/superpowers/specs/2026-09-14-shopreturn-design.md`
**Predecessors:** `2026-09-14-shopreturn-blocks-foundation.md` (complete), `2026-09-14-shopreturn-access-enforcement.md` (complete, 6/6 passing)
**Read before touching `rules.json`:** `blocks/data/ACCESS-NOTES.md` — the observed semantics of `accessLevel`, the claim names, and the rule shapes. It is the only record of any of it.

## Why this plan leads with a security gap

Plan 2 proved six read-side assertions. It also surfaced one hole it could not close:

> **Write-side ownership is unenforced.** Whether a row-field rule is evaluated against an inbound row on insert is unverified, so `customer-creates-returns` checks role only. A customer could insert a `ReturnCase` naming someone else as owner.

Everything the customer portal does begins with a customer creating a return. Building that UI before closing this would mean shipping a forgery path and then trying to retrofit the fix underneath working code. Task 1 closes it first.

## Global Constraints

- Project tenantId / `x-blocks-key`: `Df53833214f2a4243b696b55040b32509`. Pass `--project Df53833214f2a4243b696b55040b32509 --account default` on every `blocks` command.
- API URL `https://api.seliseblocks.com`. App domain `https://dbzjdy.slsblx.com`.
- **NEVER run `blocks new web --dry-run`.** In CLI 0.5.0 `confirmMutation` early-returns on `--dry-run` and `new web` never branches on it, so `--dry-run` performs the mutation *with the confirmation skipped* — it enables OIDC on the tenant and creates an OIDC client. Treat running it as equivalent to running the real thing.
- **Run `npm run assert` after every single `rules.json` change.** Claim names and operand fields are not validated at write time: a wrong one deploys with `isSuccess: true` and silently matches nothing. The suite is the only guard.
- Prefer `blocks data sync --yes` over a bare `rules deploy` — nothing else calls `data reload`, so changes can sit staged but not live.
- `--dry-run` before `--yes` on every cloud mutation, and show the user before applying.
- Run `blocks` commands sequentially; parallel runs fail with `auth_transition_busy`.
- On an expired token run `blocks auth refresh --project --json`. Never `blocks login` from a subagent.
- A 200 carrying `isSuccess: false` is a failure. A GraphQL 200 with a non-empty `errors` array is a failure.
- Never print or commit a password or token. Test credentials live only in `tools/access-check/.env` (gitignored).

## Facts established by earlier plans — do not re-derive these

- `blocks.data.collection(name)` takes the **schema name** (`"ReturnCase"`), not the `blx_*` collection name.
- `blocks.auth.login()` takes `{ username, password }`; the token field is `access_token`.
- **The login response carries no user id.** Use `blocksClient.iam.me()` to get the signed-in user's `itemId`.
- `accessLevel: 3` (Custom) is the only level at which policies are evaluated. Levels 0/1/2 ignore them.
- A static operand goes in `staticValue`, **not** `rightOperand`. Booleans must be real JSON booleans.
- The user-id claim is `UserId`/`userId`. Role matching uses the `roles` claim against the role slug.
- A rule-less allow policy denies everything, including the row owner. Every policy must carry a rule.
- `iam users create` produces `active: false, isVerified: false` accounts. `iam users activate` sets both in one call.

---

### Task 1: Assertion 7 — close the write-side ownership hole

**Files:**
- Modify: `tools/access-check/assertions.mjs`
- Modify: `blocks/data/rules.json`
- Modify: `blocks/data/ACCESS-NOTES.md`

**Interfaces:**
- Consumes: `signIn` from `client.mjs`, ids from `fixture-ids.json`, the deployed policy set.
- Produces: a 7-assertion suite; `npm run assert` exits 0 only when all seven pass.

- [ ] **Step 1: Write assertion 7 — it must fail first**

Add to `tools/access-check/assertions.mjs`:

**Assertion 7 — customer B cannot create a `ReturnCase` owned by customer A.** Signed in as customer B, call `blocks.data.collection("ReturnCase").create({...})` with `customerItemId` set to `customerAItemId` from `fixture-ids.json`, `orderNumber` `"10-9999"`, `sku` `"SH-022"`, `status` `"SUBMITTED"`, `rawCustomerText` `"forgery probe"`.

Passes when the create is **denied** (throws, or returns `isSuccess: false`). Fails when the row is created.

**If it creates the row, immediately delete it** (`.delete(itemId)` as ops if customer B cannot) so the fixture set stays clean, and report that you did. A probe that leaves debris behind corrupts later runs.

- [ ] **Step 2: Run the suite — expect 6/7**

```bash
cd tools/access-check && node --env-file=.env assertions.mjs
```

Expected: assertions 1–6 PASS, assertion 7 FAIL. Record the verbatim output. **If assertion 7 passes already**, write-side ownership is enforced after all — record that as the finding, note it in `ACCESS-NOTES.md`, and skip to Step 5.

- [ ] **Step 3: Close the hole**

Edit the `customer-creates-returns` policy in `blocks/data/rules.json` so the inbound row's `customerItemId` must equal the caller. Add to its `ruleGroup.rules`, alongside the existing role rule:

```json
{ "leftSource": 1, "leftOperand": "customerItemId", "operator": 0, "rightSource": 0, "rightOperand": "UserId" }
```

with `logicalOperator` set so both rules must hold (AND). Consult `ACCESS-NOTES.md` for the confirmed `logicalOperator` value rather than assuming.

Deploy:

```bash
blocks data sync --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Show the user, get approval, then `--yes`.

- [ ] **Step 4: Re-run until 7/7**

Re-run the suite. If assertion 7 still fails, the row-field rule is not evaluated on insert — that is a real platform limitation, not a bug in your policy.

**If you cannot close it in `rules.json`, say so plainly and stop.** Do not fake it. The fallback then belongs in application code (the portal always sets `customerItemId` from `iam.me()`), which is weaker — it protects the app's own users but not a hand-crafted API call — and the user must be told that explicitly rather than discovering it later.

Watch assertion 2, the control: if it starts failing, the added rule is also blocking legitimate reads.

- [ ] **Step 5: Document and commit**

Add a section to `blocks/data/ACCESS-NOTES.md` recording whether write-side row rules are evaluated on insert, with the observation behind the answer.

```bash
git add tools/access-check/assertions.mjs blocks/data/rules.json blocks/data/ACCESS-NOTES.md
git commit -m "feat(access-check): assertion 7 — write-side ownership cannot be forged"
```

---

### Task 2: Enable customer self-signup

**Files:**
- Create: `blocks/iam/signup-settings.md`

**Interfaces:**
- Consumes: role slug `customer` from Plan 1.
- Produces: a project where a stranger can register and land with the `customer` role.

- [ ] **Step 1: Record the current state**

```bash
blocks iam signup-settings get --project Df53833214f2a4243b696b55040b32509 --account default --json
```

Expected at the start: `isSignUpEnable: false`, `isEmailPasswordSignUpEnabled: false`, `defaultRolesForNewUser: []`.

- [ ] **Step 2: Dry-run the change**

```bash
blocks iam signup-settings save --email-password-signup --default-roles customer \
  --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

The CLI reads current settings and merges, so this will not clear the other fields.

**Open question to resolve here:** the CLI's save body carries `isEmailPasswordSignUpEnabled`, `isSSoSignUpEnabled`, `defaultRolesForNewUserOnSignUp` and `defaultPermissionsForNewUserOnSignUp` — but **not** `isSignUpEnable`, the master toggle that currently reads `false`. Inspect the dry-run body and confirm whether `isSignUpEnable` appears. If it does not, the master toggle may need `--body '{"isSignUpEnable": true, ...}'`. Report which was needed.

Show the user the dry-run, get approval, then apply with `--yes`.

- [ ] **Step 3: Verify by reading back**

```bash
blocks iam signup-settings get --project Df53833214f2a4243b696b55040b32509 --account default --json
```

Expected: `isEmailPasswordSignUpEnabled: true`, `defaultRolesForNewUser: ["customer"]`, and `isSignUpEnable: true`. If the master toggle is still false, go back to Step 2 with `--body`.

- [ ] **Step 4: Prove it with a real self-registration**

Settings reading correctly is not proof that signup works. Register a genuinely new user through the API the way a stranger would — `blocksClient.auth` has the signup surface; check `blocks-cli/blocks-client/src/auth/auth-client.ts` for the exact method and payload rather than guessing.

Use `shopreturn-selfreg@yopmail.com`. Then:

1. Read the yopmail inbox at `https://yopmail.com/en/wm` (local part `shopreturn-selfreg`) and report whether an activation mail arrived, and what it contains. **Do not click the link yet.**
2. Report whether the new user landed with the `customer` role: `blocks iam users list --email shopreturn-selfreg@yopmail.com --project Df53833214f2a4243b696b55040b32509 --account default --json`.

This is the single most important step in the task. The spec's entire customer story depends on a stranger being able to register, and every earlier user in this project was created by an admin and activated by an admin — a path a real customer never takes.

- [ ] **Step 5: Complete the activation the way a customer would**

If an activation mail arrived, follow its link and confirm the account becomes `active: true, isVerified: true` **without** any `blocks iam users activate` call. Then confirm the user can log in via `signIn()`.

If no mail arrived, report that plainly — it means self-registration is incomplete on this project, and the demo's customer story needs either mail configuration work or a documented admin-activation step. Do not paper over it with `iam users activate`.

- [ ] **Step 6: Document and commit**

Write `blocks/iam/signup-settings.md`: what was enabled, the exact command used, whether `isSignUpEnable` needed `--body`, whether activation mail is delivered, and what a real customer's registration journey looks like end to end.

```bash
git add blocks/iam/signup-settings.md
git commit -m "feat(iam): enable email/password self-signup with customer default role"
```

---

### Task 3: Provision the OIDC client

**Files:**
- Create: `blocks/auth/oidc-client.md`

**Interfaces:**
- Produces: an OIDC client id, consumed by Task 4's `blocks new web --client-id`.

- [ ] **Step 1: Confirm nothing exists yet**

```bash
blocks auth oidc-clients list --project Df53833214f2a4243b696b55040b32509 --account default --json
blocks auth config get --project Df53833214f2a4243b696b55040b32509 --account default --json
```

Expected at the start: `oIDCClientCredentials: []` and `isOidcEnabled: false`.

- [ ] **Step 2: Dry-run the client**

```bash
blocks auth oidc-clients save \
  --client-display-name "ShopReturn Web" \
  --redirect-uris "https://dbzjdy.slsblx.com/login/callback,https://localhost:5173/login/callback" \
  --post-logout-redirect-uris "https://dbzjdy.slsblx.com,https://localhost:5173" \
  --active --require-pkce --auto-redirect --register-as-identity-provider \
  --scope "openid profile" \
  --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Both redirect URIs matter: the deployed domain and the local HTTPS dev server the scaffold runs on. A missing local URI means login works in production and fails on the developer's machine.

Show the user, get approval, apply with `--yes`. **Record the returned client id.** If the response carries a client secret it is shown once — do not print it into the report, the commit, or the terminal transcript; this is a public browser client and should not need one.

- [ ] **Step 3: Enable OIDC on the tenant**

```bash
blocks auth config save --oidc-enabled --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Check the flag name against `blocks help auth config save --json` first — an unknown flag only warns, and the value would be silently dropped. The command merges current config, so `accountActionBaseUrl` (already `https://dbzjdy.slsblx.com`) is preserved. Approve, apply, then read back and confirm `isOidcEnabled: true`.

- [ ] **Step 4: Document and commit**

Write `blocks/auth/oidc-client.md`: the client id, display name, both redirect URI sets, the flags used and why, and a note that no secret is stored anywhere because this is a public browser client.

```bash
git add blocks/auth/oidc-client.md
git commit -m "feat(auth): provision ShopReturn Web OIDC client and enable OIDC"
```

---

### Task 4: Scaffold the app and prove a customer can sign in

**Files:**
- Create: `app/` (whatever `blocks new web` generates)

**Interfaces:**
- Consumes: the OIDC client id from Task 3.
- Produces: a running app a customer can log into. Plan 4 builds the portal UI inside it.

- [ ] **Step 1: Scaffold**

**Do not use `--dry-run` on this command** — see Global Constraints. There is no safe preview; run it once, for real, with every value supplied explicitly so it never prompts:

```bash
cd D:/Construct/Hackathon_Blocks && blocks new web app \
  --x-blocks-key Df53833214f2a4243b696b55040b32509 \
  --app-domain https://dbzjdy.slsblx.com \
  --client-id <client id from Task 3> \
  --account default --json
```

Non-interactive runs fail with `interactive_input_required` if `--app-domain` or `--client-id` is missing, so supply both. Report exactly what it created and any warning it printed.

- [ ] **Step 2: Install and build**

```bash
cd app && npm install && npm run build
```

A clean build proves the scaffold is coherent before anyone touches it. Report any error verbatim rather than fixing it silently — a broken scaffold is a finding about the CLI, and Plan 4 needs to know.

- [ ] **Step 3: Confirm the app talks to Blocks through the SDK only**

```bash
grep -rn "fetch(\|axios" app/src --include=*.ts --include=*.tsx | grep -v node_modules
```

Expected: no raw calls to `api.seliseblocks.com`. Everything should route through the single `createBlocksClient()` instance the scaffold wires at `src/lib/blocks/client.ts`. Report anything that does not.

- [ ] **Step 4: Run it and sign in as a real customer**

```bash
cd app && npm run cert && npm run dev
```

Then, in a browser, sign in as `shopreturn-customer-a@yopmail.com` using the password in `tools/access-check/.env`.

Confirm and report: the login redirect reaches the hosted IdP; the callback returns to the app; `blocksClient.iam.me()` returns customer A's `itemId`; and the app holds a session. Take a screenshot of the signed-in state.

If `npm run cert` needs a hosts-file entry the scaffold's README explains it — report what was required rather than silently editing system files.

- [ ] **Step 5: Confirm the boundary still holds from inside the app**

While signed in as customer A, read `ReturnCase` through the app's own client and confirm exactly one row comes back — the seeded return — and that `aiReason` is absent from it.

This is the same guarantee assertions 2 and 3 prove headlessly, verified through the real browser path with a real OIDC token rather than a password-grant token. **They are different token acquisition paths and may carry different claims** — if the app sees something the assertion suite does not, that is an important finding and the claim shape in `ACCESS-NOTES.md` needs revisiting.

- [ ] **Step 6: Commit**

Confirm `app/node_modules` and any `app/.env` are gitignored before staging.

```bash
git add app .gitignore
git commit -m "feat(app): scaffold ShopReturn web app with customer login"
```

---

## Self-review notes

**Spec coverage.** §5 access model, write side → Task 1. The spec's customer self-registration assumption → Task 2. §7 customer portal prerequisites → Tasks 3 and 4. The portal UI itself, the ledger timeline, and the intake agent → **not here**; they are Plan 4.

**Deferred to later plans:** the customer portal UI and intake agent (Plan 4); the ops console (Plan 5); the manager dashboard and Pattern Watch (Plan 6).

**Known soft spots, stated rather than hidden:**
- Task 1 Step 4 may prove the hole cannot be closed in `rules.json` at all. The fallback is application-level and explicitly weaker; the plan says to tell the user rather than quietly accept it.
- Task 2 Step 2 has an open question about `isSignUpEnable` that only the dry-run body can answer, and Step 4 may find self-registration is incomplete on this project. Both are real risks to the spec's customer story and are surfaced rather than assumed away.
- Task 3 Step 3 asks for the `--oidc-enabled` flag name to be verified against `blocks help` first, because an unknown flag only warns and would be silently dropped.
- Task 4 Step 1 runs an irreversible-ish command with no preview available. Every value is supplied explicitly so it cannot prompt or guess.
- Task 4 Step 5 compares two different token-acquisition paths. If they disagree, the headless suite's guarantees do not automatically transfer to the browser, and that would be worth knowing before any UI is built on them.
