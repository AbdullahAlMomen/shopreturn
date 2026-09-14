# ShopReturn Access Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove — with a repeatable script, not an assertion in prose — that the ShopReturn access boundary holds: a customer cannot read another customer's return, cannot read their own unconfirmed AI fields, and cannot touch `Inspection`, `PatternAlert` or `Decision` at all; and that nobody, including ops, can edit or delete a `ReturnTimeline` row.

**Architecture:** A small Node harness under `tools/access-check/` using `@seliseblocks/client`. It signs in as four seeded test users via `auth.login()` (username/password — no browser needed), then exercises the six assertions through `data.collection(...)`. The harness is the deliverable, not scaffolding: it re-runs after every policy change and becomes the security demo for judges.

**Tech Stack:** Node 20+, `@seliseblocks/client`, `@seliseblocks/cli-os` 0.5.0 for the policy deploy.

**Spec:** `docs/superpowers/specs/2026-09-14-shopreturn-design.md`
**Predecessor:** `docs/superpowers/plans/2026-09-14-shopreturn-blocks-foundation.md` (complete; Task 6 authored-not-deployed by decision)
**Verified API contract:** `.superpowers/sdd/2026-09-14-shopreturn-blocks-foundation/data-access-contract.md` — read this before touching `rules.json`.

## Why this plan exists before any UI

Plan 1 authored 28 security entries and 24 policies but deployed none of them. Two things were unresolved and neither can be settled without a signed-in client:

1. **Nothing in the policy shape binds a policy to a role.** A policy read back from the server is `{itemId, policyName, policyDescription, policyType, operation, entityName, fieldNames, schemaId, ruleGroup, priority, isAllowPolicy}`. There is no `roles` field. 20 of the 24 authored policies are therefore unconditional allows.
2. **Claim names are not validated at authoring time.** The server accepted a policy referencing `ThisClaimDoesNotExist` with `isSuccess: true`. `"UserId"` is a hypothesis.

Deploying an unverified policy set produces a boundary that reports healthy and enforces nothing. This plan refuses to build UI on that.

## Global Constraints

- Project tenantId / `x-blocks-key`: `Df53833214f2a4243b696b55040b32509`. Pass `--project Df53833214f2a4243b696b55040b32509 --account default` on every `blocks` command.
- API URL: `https://api.seliseblocks.com`.
- **`--dry-run` before `--yes` on every cloud mutation**, and show the user before applying.
- **Never run `blocks new web --dry-run`** — in CLI 0.5.0 it performs the mutation with the confirmation skipped. This plan does not scaffold an app; do not add it.
- Run `blocks` commands sequentially — parallel invocations fail with `auth_transition_busy`.
- If a command reports an expired token, run `blocks auth refresh --project --json`. Never `blocks login` from a subagent.
- A 200 response carrying `isSuccess: false` is a failure. A GraphQL 200 carrying an `errors` array is a failure.
- **Never commit a password.** Test-user passwords go in `tools/access-check/.env`, which must be gitignored. `.env` is already covered by the repo's `.gitignore`.
- Never print, open or read the CLI's config/token/secret files.
- Schema field types, established in Plan 1: `String`, `Boolean`, `Int`, `Float`, `DateTime`. Nothing else is accepted.
- Current state: all 7 schemas are at `accessLevel: 2` (Public) on all 4 operations. No data policies are deployed.

---

### Task 1: Harness project, four test users, and proof that login works

**Files:**
- Create: `tools/access-check/package.json`
- Create: `tools/access-check/client.mjs`
- Create: `tools/access-check/login-check.mjs`
- Create: `tools/access-check/.env.example`
- Create: `blocks/iam/test-users.md`

**Interfaces:**
- Consumes: role slugs `customer`, `ops`, `manager` from Plan 1.
- Produces: `client.mjs` exporting `signIn(email, password) -> { blocks, token }` and `CONFIG`. Tasks 2–4 import it.

- [ ] **Step 1: Create the harness package**

`tools/access-check/package.json`:

```json
{
  "name": "shopreturn-access-check",
  "private": true,
  "type": "module",
  "scripts": {
    "login": "node login-check.mjs",
    "seed": "node seed.mjs",
    "assert": "node assertions.mjs"
  },
  "dependencies": {
    "@seliseblocks/client": "^0.1.0"
  }
}
```

Then install:

```bash
cd tools/access-check && npm install
```

If `^0.1.0` does not resolve, run `npm view @seliseblocks/client version`, use that exact version, and record what you used in the report.

- [ ] **Step 2: Write the shared client module**

`tools/access-check/client.mjs`:

```js
import { createBlocksClient } from "@seliseblocks/client";

export const CONFIG = {
  apiUrl: "https://api.seliseblocks.com",
  xBlocksKey: "Df53833214f2a4243b696b55040b32509"
};

/**
 * Signs in with username/password and returns a client bound to that session.
 * The SDK does not store tokens, so the caller owns them — which is what lets
 * this harness hold four independent sessions at once.
 */
export async function signIn(email, password) {
  let token;
  const blocks = createBlocksClient({
    apiUrl: CONFIG.apiUrl,
    xBlocksKey: CONFIG.xBlocksKey,
    accessToken: () => token
  });

  const response = await blocks.auth.login({ email, password });
  token = response?.access_token ?? response?.accessToken;
  if (!token) {
    throw new Error(`login for ${email} returned no access token: ${JSON.stringify(response)}`);
  }
  return { blocks, token };
}
```

**The response field name is unverified.** IAM may return `access_token` or `accessToken`; the code above accepts either. If neither is present the error prints the whole response — record the real field name in your report and simplify the code to match.

- [ ] **Step 3: Write `.env.example` and confirm `.env` is ignored**

`tools/access-check/.env.example`:

```
SHOPRETURN_CUSTOMER_A_EMAIL=shopreturn-customer-a@example.com
SHOPRETURN_CUSTOMER_A_PASSWORD=
SHOPRETURN_CUSTOMER_B_EMAIL=shopreturn-customer-b@example.com
SHOPRETURN_CUSTOMER_B_PASSWORD=
SHOPRETURN_OPS_EMAIL=shopreturn-ops@example.com
SHOPRETURN_OPS_PASSWORD=
SHOPRETURN_MANAGER_EMAIL=shopreturn-manager@example.com
SHOPRETURN_MANAGER_PASSWORD=
```

Verify the real `.env` will not be committed:

```bash
cd D:/Construct/Hackathon_Blocks && git check-ignore -v tools/access-check/.env
```

Expected: a line naming `.gitignore` and the `.env` rule. If it prints nothing, STOP and add `.env` to `.gitignore` before creating any user.

- [ ] **Step 4: Dry-run the four user creates**

```bash
blocks iam users create --email shopreturn-customer-a@example.com --first-name Customer --last-name A \
  --roles customer --password '<generated>' \
  --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Repeat for `shopreturn-customer-b@example.com` (roles `customer`), `shopreturn-ops@example.com` (roles `ops`), `shopreturn-manager@example.com` (roles `manager`).

Generate a distinct strong password per user. **Show the user the dry-run output with passwords redacted, and get approval before applying.** The dry-run redacts `password` automatically — confirm that it does before showing it; if a password appears in the output, stop and report it.

- [ ] **Step 5: Create the four users after approval**

Re-run each command with `--yes` instead of `--dry-run`. Write the passwords into `tools/access-check/.env` (never into `.env.example`, never into a commit, never into the report file).

- [ ] **Step 6: Write the login check**

`tools/access-check/login-check.mjs`:

```js
import { signIn } from "./client.mjs";

const USERS = [
  ["customerA", process.env.SHOPRETURN_CUSTOMER_A_EMAIL, process.env.SHOPRETURN_CUSTOMER_A_PASSWORD],
  ["customerB", process.env.SHOPRETURN_CUSTOMER_B_EMAIL, process.env.SHOPRETURN_CUSTOMER_B_PASSWORD],
  ["ops", process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD],
  ["manager", process.env.SHOPRETURN_MANAGER_EMAIL, process.env.SHOPRETURN_MANAGER_PASSWORD]
];

let failed = 0;
for (const [label, email, password] of USERS) {
  try {
    const { token } = await signIn(email, password);
    console.log(`ok    ${label.padEnd(10)} token length ${token.length}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${label.padEnd(10)} ${error.message}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 7: Run it**

```bash
cd tools/access-check && node --env-file=.env login-check.mjs
```

Expected: four `ok` lines, exit 0. Never print a token value — the length is the proof, and a token in a terminal transcript is a leaked credential.

If login fails for every user, the likely causes in order: the IdP requires activation before first login (`iam users activate`), the login payload field names differ from `{email, password}`, or `isOidcEnabled: false` blocks this path. Diagnose and report; do not work around it by weakening anything.

- [ ] **Step 8: Record the users and commit**

Write `blocks/iam/test-users.md` listing each email, its role slug, and its purpose — **no passwords**. Note that these are test fixtures and should be deactivated (`iam users deactivate`) before any production use.

```bash
git add tools/access-check/package.json tools/access-check/client.mjs tools/access-check/login-check.mjs tools/access-check/.env.example blocks/iam/test-users.md
git commit -m "feat(access-check): harness and four role test users"
```

Confirm `git status` shows no `.env` and no `node_modules/` staged.

---

### Task 2: Seed the fixture data the assertions need

**Files:**
- Create: `tools/access-check/seed.mjs`

**Interfaces:**
- Consumes: `signIn` from Task 1.
- Produces: `seed.mjs` writing fixture rows and printing their ids as JSON; Task 3 reads the ids from `tools/access-check/fixture-ids.json`.

- [ ] **Step 1: Confirm how `data.collection()` addresses a schema**

Our schemas are singular (`ReturnCase`) with collection names plural (`blx_ReturnCases`). The SDK's README example uses `blocks.data.collection("Students")`, which does not settle which of the two it wants.

```bash
cd tools/access-check && node --env-file=.env -e "
import('./client.mjs').then(async ({ signIn }) => {
  const { blocks } = await signIn(process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD);
  for (const name of ['ReturnCase', 'blx_ReturnCases', 'ReturnCases']) {
    try {
      const r = await blocks.data.collection(name).list({ pageNo: 1, pageSize: 1 });
      console.log('OK  ', name, JSON.stringify(r).slice(0, 120));
    } catch (e) { console.log('FAIL', name, e.message.slice(0, 120)); }
  }
});
"
```

**Record which form works and use it consistently.** If more than one works, prefer the schema name. If none works, report the errors verbatim — the GraphQL operation names from `blocks data schema get ReturnCase --json` are the next place to look.

- [ ] **Step 2: Write the seed script**

`tools/access-check/seed.mjs` — signs in as ops and creates:

1. One `Order`: `orderNumber` `10-4821`, `sku` `SH-022`, `productName` `Canvas Sneaker`, `unitPrice` `1450`, `area` `Mirpur 11`, `courier` `Sundarban Courier`, `customerEmail` = customer A's email.
2. One `ReturnCase` owned by **customer A** — set `customerItemId` to customer A's user itemId (obtain it from the login response, or `blocks iam users list --email …`), `orderNumber` `10-4821`, `sku` `SH-022`, `status` `SUBMITTED`, `rawCustomerText` `order #10-4821 er shoe ta box chire geche, ekta shoe er sole alada hoye geche.`, `aiReason` `DAMAGED_IN_TRANSIT`, `aiConfidence` `0.86`, `aiRestockable` `false`, `aiCourierClaim` `true`, `aiDraftMessage` `We've received your return request and will inspect the item.`
3. One `ReturnTimeline` row for that return: `customerItemId` = customer A, `status` `SUBMITTED`, `message` `Return request received.`, `isCustomerVisible` `true`.
4. One `Inspection` row for that return: `customerItemId` = customer A, `conditionOnArrival` `MAJOR_DAMAGE`, `restockable` `false`, `faultAttribution` `COURIER`, `inspectorNotes` `Sole detached in transit; box crushed.`

Write every created `itemId` to `tools/access-check/fixture-ids.json`.

**Deliberately do not set `confirmedReason`.** The assertions check that a customer cannot read `aiReason`; leaving the confirmed column empty keeps the two clearly distinguishable in the output.

- [ ] **Step 3: Run the seed**

```bash
cd tools/access-check && node --env-file=.env seed.mjs
```

Expected: four ids printed and written to `fixture-ids.json`. This currently succeeds because every schema is Public — that is the state Task 4 changes.

- [ ] **Step 4: Commit**

```bash
git add tools/access-check/seed.mjs tools/access-check/fixture-ids.json
git commit -m "feat(access-check): seed fixture order, return, timeline and inspection"
```

---

### Task 3: The six assertions — they must fail first

**Files:**
- Create: `tools/access-check/assertions.mjs`

**Interfaces:**
- Consumes: `signIn` from Task 1, `fixture-ids.json` from Task 2.
- Produces: `npm run assert` exiting 0 only when all six pass.

- [ ] **Step 1: Write the assertion suite**

`tools/access-check/assertions.mjs` implements exactly these six, each printing `PASS` or `FAIL` with a one-line reason, and exiting non-zero if any fail:

| # | Assertion | Expected |
|---|---|---|
| 1 | Customer B reads customer A's `ReturnCase` by itemId | denied or empty |
| 2 | Customer A reads their own `ReturnCase` | succeeds |
| 3 | Customer A reads `aiReason` on their own `ReturnCase` | absent, null or masked |
| 4 | Customer A lists `Inspection` | denied or empty |
| 5 | Customer A lists `PatternAlert` | denied or empty |
| 6 | Ops updates the seeded `ReturnTimeline` row | denied |

Treat "denied" as either a thrown error **or** an empty result set — a row-level policy typically filters rather than throws, and a suite that only accepts a thrown error will report false failures. Print which of the two occurred, because that distinction matters for the next task.

Assertion 2 is the control. If it fails, the boundary is too tight rather than too loose, and that is just as broken.

- [ ] **Step 2: Run the suite and record the failures**

```bash
cd tools/access-check && node --env-file=.env assertions.mjs
```

Expected **now**: assertions 1, 3, 4, 5 and 6 FAIL, assertion 2 passes. Everything is Public and no policies are deployed, so there is nothing to enforce. **This is the failing test.** Save the full output into the task report verbatim — it is the before-half of the proof.

If any of 1, 3, 4, 5 or 6 unexpectedly passes, stop and investigate before proceeding: something is already restricting access and the model of the system is wrong.

- [ ] **Step 3: Commit**

```bash
git add tools/access-check/assertions.mjs
git commit -m "test(access-check): six access assertions, currently failing"
```

---

### Task 4: Resolve role binding, deploy, and iterate until green

This is the task the whole plan exists for. It is explicitly iterative — expect several deploy-and-re-run cycles.

**Files:**
- Modify: `blocks/data/rules.json`
- Create: `blocks/data/ACCESS-NOTES.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a deployed policy set with all six assertions passing, and written-up semantics for the enums Plan 1 could not verify.

- [ ] **Step 1: Establish how a policy binds to a role**

Read `.superpowers/sdd/2026-09-14-shopreturn-blocks-foundation/data-access-contract.md` first. Then test the two candidate mechanisms, cheapest first:

**Candidate A — a role claim in the ruleGroup.** Deploy one policy on `Inspection` with a rule `{ "leftSource": 0, "leftOperand": "Roles", "operator": 0, "rightSource": 2, "rightOperand": "ops" }` and re-run assertion 4. Try `Role` as well as `Roles`. Remember claim names are not validated at write time, so a clean deploy proves nothing — only the assertion result does.

**Candidate B — IAM permissions.** `blocks iam permissions list --json` and `blocks iam roles assign-permissions`. Permission type 3 is `DataProtection`, which governs masking. If role scoping lives here rather than in `rules.json`, assertion 3 in particular may be an IAM concern.

Record which mechanism works, with evidence. **If neither does**, that is a finding worth reporting rather than papering over: say so plainly, and fall back to the narrowest arrangement that makes assertions 1 and 3–6 pass, even if it means fewer roles can do less than the spec's matrix allows. A boundary that is too tight is fixable; one that is too loose is the failure this plan exists to prevent.

- [ ] **Step 2: Deploy the security entries and re-run**

```bash
blocks data rules deploy --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Show the user, get approval, then `--yes`. Re-run the assertions.

**If assertion 2 (the control) now fails**, `accessLevel: 1` is too restrictive. Try `3`, then `0`, re-running the control each time, and record what each value does. This is how the `accessLevel` enum gets documented — by observing behaviour, since no endpoint exposes its meaning.

- [ ] **Step 3: Iterate the policy set to green**

Adjust `blocks/data/rules.json`, redeploy, re-run. Repeat until all six assertions pass. After each cycle append one line to the report: what changed, and which assertions moved.

Watch for the trap this plan was built around: 20 of the authored policies have no rule. If role binding turns out to be unexpressible in `rules.json`, **delete those unconditional-allow policies rather than deploying them** — an absent policy is honest, a universal allow that looks role-scoped is not.

- [ ] **Step 4: Confirm the claim name**

With the suite green, prove `"UserId"` is actually doing the work rather than accidentally passing: change it to `ThisClaimDoesNotExist` in the `customer-reads-own-returns` policy, redeploy, and re-run.

Expected: assertion 1 or 2 changes state. If **nothing** changes, the claim is being ignored and assertions are passing for some other reason — investigate before declaring success. Restore `"UserId"` afterwards and redeploy.

This step exists because Plan 1 proved the server accepts any claim name silently. Without it, "the assertions pass" does not mean "the policy works".

- [ ] **Step 5: Write up the semantics**

`blocks/data/ACCESS-NOTES.md` records, as established facts with the evidence for each: what `accessLevel` 0/1/2/3 each do; how a policy binds to a role; the correct claim name for the calling user's id; which `operator` and `logicalOperator` values were used and what they mean; and anything still unknown.

This file is the answer to the questions Plan 1 had to leave open. Write it for someone who has never seen this project.

- [ ] **Step 6: Final verification and commit**

```bash
cd tools/access-check && node --env-file=.env assertions.mjs
```

Expected: six PASS, exit 0.

```bash
git add blocks/data/rules.json blocks/data/ACCESS-NOTES.md
git commit -m "feat(data): deploy verified access policies; all six assertions pass"
```

---

## Self-review notes

**Spec coverage.** §5 access model → Tasks 3–4 (the six assertions are the spec's access rules made executable). Spec open-question 3 (can `ruleGroup` reference the calling user) → answered structurally in Plan 1, proven behaviourally in Task 4 Step 4. Spec §9 items 1 and 2 (unverified Blocks Agents capabilities) → **not in this plan**; they belong to the agent plan.

**Deferred to later plans:** the customer portal and intake agent; the ops console; the manager dashboard, pattern detection and Pattern Watch agent. None should start until `npm run assert` exits 0.

**Known soft spots, stated rather than hidden:**
- Task 1 Step 2 guesses the login response's token field name and accepts either spelling. The step says to record the real one and simplify.
- Task 2 Step 1 probes how `data.collection()` addresses a schema, because the SDK README's example does not disambiguate schema name from collection name.
- Task 4 Step 1 is genuinely open-ended: two candidate mechanisms, and the possibility that neither works. The fallback is specified — tighten rather than loosen — so the task cannot end in a false pass.
- The whole plan assumes `auth.login()` works for these users. If the IdP demands activation or OIDC enablement first, Task 1 Step 7 catches it early, before anything depends on it.
