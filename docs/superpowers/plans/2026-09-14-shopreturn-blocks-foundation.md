# ShopReturn Blocks Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the ShopReturn data model, seed data, roles, and server-enforced access policies in the Blocks project, so that a customer provably cannot read another customer's return or their own unconfirmed AI fields.

**Architecture:** Seven schemas authored as JSON under `blocks/data/schemas/`, deployed with `blocks data sync`. Three IAM roles created through `blocks iam roles`. Access enforced by Data policies in `blocks/data/rules.json` — row-level via `ruleGroup`, field-level via `fieldNames` — never in client code. Ownership is denormalised onto every child row as `customerItemId` so every policy is a single-row predicate.

**Tech Stack:** `@seliseblocks/cli-os` 0.5.0 (CLI, already installed globally), Blocks Data Gateway (Blocks-managed storage, collection pattern `blx_{SchemaName}s`), Blocks IAM.

**Spec:** `docs/superpowers/specs/2026-09-14-shopreturn-design.md`

## Global Constraints

- Project tenantId (`x-blocks-key`): `Df53833214f2a4243b696b55040b32509`. Pass `--project Df53833214f2a4243b696b55040b32509` explicitly on every command.
- CLI account: `default` (`abdullah.momen@selisegroup.com`). Pass `--account default` explicitly.
- **`--dry-run` before `--yes` on every cloud mutation.** Show the user the dry-run output and get approval before the `--yes` run. Never chain them in one command.
- **Never use `blocks new web --dry-run`** — in CLI 0.5.0 it performs the mutation with the confirmation skipped. Not used in this plan, but do not add it.
- Never print, open, or read the CLI's config/token/secret files. Diagnose only through `blocks auth status` and `blocks doctor`.
- Run CLI commands **sequentially**. Parallel invocations against one config directory fail with `auth_transition_busy`.
- Platform-managed field names must never be declared in a schema: `ItemId`, `CreatedDate`, `CreatedBy`, `LastUpdatedDate`, `LastUpdatedBy`, `Language`, `OrganizationId`, `Tags`.
- Schema field shape is `{name, type, isArray, isPIIData, isUniqueData, description}`.
- A 200 response carrying `isSuccess: false` is a failure. Treat a GraphQL response with an `errors` array as a failure too.
- Status vocabulary, exact strings: `SUBMITTED`, `ACCEPTED`, `RECEIVED`, `INSPECTED`, `REFUND_PROCESSING`, `REFUNDED`, `REJECTED`.
- Reason vocabulary, exact strings: `DAMAGED_IN_TRANSIT`, `WRONG_SIZE`, `DEFECTIVE`, `COD_REFUSAL`, `CHANGED_MIND`, `LATE_DELIVERY`, `OTHER`.

---

### Task 1: Workspace init and the `Orders` seed schema

This task also establishes the canonical schema JSON shape the rest of the plan depends on. `Orders` stands in for the seller's order system and backs the agent's `lookupOrder` tool.

**Files:**
- Create: `blocks.json` (via `blocks init`)
- Create: `blocks/data/schemas/Orders.json`
- Create: `blocks/data/rules.json` (via `blocks init`, empty policy list)
- Create: `.env.example` (via `blocks init`)

**Interfaces:**
- Consumes: nothing.
- Produces: schema `Orders` with fields `orderNumber`, `sku`, `productName`, `unitPrice`, `area`, `courier`, `customerEmail`. Later tasks reference `Orders.orderNumber` and `Orders.sku`.

- [ ] **Step 1: Confirm session state before touching anything**

```bash
blocks auth status --json
blocks doctor --json
blocks data schema list --project Df53833214f2a4243b696b55040b32509 --account default --json
```

Expected: `projectAccessToken` and `projectRefreshToken` are `valid`; schema list returns `"totalCount": 0`. If tokens are missing, stop and run `blocks login --account default`, then re-check.

- [ ] **Step 2: Initialize the workspace**

```bash
blocks init --json
```

Expected: creates `blocks.json`, `blocks/data/schemas/`, `blocks/data/rules.json`, `.env.example`. It is safe to re-run — it never overwrites an existing file.

- [ ] **Step 3: Write the `Orders` schema**

Create `blocks/data/schemas/Orders.json`:

```json
{
  "schemaName": "Orders",
  "fields": [
    { "name": "orderNumber", "type": "string", "isUniqueData": true, "description": "Seller order reference, e.g. 10-4821" },
    { "name": "sku", "type": "string", "description": "Product SKU, e.g. SH-022" },
    { "name": "productName", "type": "string", "description": "Human-readable product name" },
    { "name": "unitPrice", "type": "number", "description": "Unit price in BDT" },
    { "name": "area", "type": "string", "description": "Delivery area, e.g. Mirpur 11" },
    { "name": "courier", "type": "string", "description": "Courier company name" },
    { "name": "customerEmail", "type": "string", "isPIIData": true, "description": "Email of the customer who placed the order" }
  ]
}
```

- [ ] **Step 4: Validate locally — this must pass before any network call**

```bash
blocks data validate --json
```

Expected: `{"ok": true, "errors": [], "schemaCount": 1}`.

If it reports `field '<name>' is platform-managed`, you declared a reserved field — remove it and re-run.

- [ ] **Step 5: Dry-run the sync and show the user**

```bash
blocks data sync --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Expected: a plan showing `Orders` as a create. **Stop here and show the output to the user. Do not proceed without approval.**

- [ ] **Step 6: Apply after approval**

```bash
blocks data sync --project Df53833214f2a4243b696b55040b32509 --account default --yes --json
```

Expected: success, and the reload step reported. `data sync` is used rather than a bare `schema push` because nothing else in the CLI calls `data reload` automatically — a push without reload leaves changes staged but not live.

- [ ] **Step 7: Verify by reading back, and record the canonical field vocabulary**

```bash
blocks data schema get-by-name Orders --project Df53833214f2a4243b696b55040b32509 --account default --json
```

Expected: the schema exists with all seven fields.

**Important:** compare the `type` value the server returns for each field against what you wrote (`"string"`, `"number"`). If the server normalises them to different spellings (for example `"Text"`, `"Decimal"`, or numeric codes), **record the exact returned vocabulary in a comment block at the top of this plan file and use those spellings in Tasks 2–4.** Do not carry on with a spelling the server did not confirm.

- [ ] **Step 8: Commit**

```bash
git add blocks.json .env.example blocks/data/
git commit -m "feat(data): workspace init and Orders seed schema"
```

---

### Task 2: `ReturnCase` and `ReturnTimeline` schemas

The spine and the trust artifact. The AI/human column split in `ReturnCase` is what makes "confirm before it counts" structural.

**Files:**
- Create: `blocks/data/schemas/ReturnCase.json`
- Create: `blocks/data/schemas/ReturnTimeline.json`

**Interfaces:**
- Consumes: `Orders.orderNumber`, `Orders.sku` from Task 1.
- Produces: `ReturnCase` (fields listed below, notably `customerItemId`, `status`, the `ai*` set, the `confirmed*` set, `opsCorrectedFields`) and `ReturnTimeline` (`returnId`, `customerItemId`, `isCustomerVisible`). Tasks 3–5 reference `ReturnCase.ItemId` as `returnId` and every child schema carries `customerItemId`.

- [ ] **Step 1: Write the `ReturnCase` schema**

Create `blocks/data/schemas/ReturnCase.json`:

```json
{
  "schemaName": "ReturnCase",
  "fields": [
    { "name": "customerItemId", "type": "string", "description": "IAM user itemId of the owning customer. Denormalised so every policy is a single-row predicate." },
    { "name": "orderNumber", "type": "string", "description": "Matches Orders.orderNumber" },
    { "name": "sku", "type": "string", "description": "Matches Orders.sku" },
    { "name": "productName", "type": "string" },
    { "name": "unitPrice", "type": "number", "description": "Unit price in BDT, copied at submission" },
    { "name": "area", "type": "string" },
    { "name": "courier", "type": "string" },
    { "name": "customerName", "type": "string", "isPIIData": true },
    { "name": "customerPhone", "type": "string", "isPIIData": true },
    { "name": "customerEmail", "type": "string", "isPIIData": true },
    { "name": "rawCustomerText", "type": "string", "description": "The customer's own words, Banglish as written" },
    { "name": "photoFileIds", "type": "string", "isArray": true, "description": "Blocks Storage file ids" },
    { "name": "status", "type": "string", "description": "SUBMITTED|ACCEPTED|RECEIVED|INSPECTED|REFUND_PROCESSING|REFUNDED|REJECTED" },
    { "name": "aiReason", "type": "string", "description": "Agent proposal. Masked from customer." },
    { "name": "aiConfidence", "type": "number", "description": "Agent proposal. Masked from customer." },
    { "name": "aiRestockable", "type": "boolean", "description": "Agent proposal. Masked from customer." },
    { "name": "aiCourierClaim", "type": "boolean", "description": "Agent proposal. Masked from customer." },
    { "name": "aiDraftMessage", "type": "string", "description": "Agent draft of the customer update. Masked from customer; published only on ops approval." },
    { "name": "confirmedReason", "type": "string", "description": "Ops-confirmed. Analytics read only this, never aiReason." },
    { "name": "restockable", "type": "boolean", "description": "Ops-confirmed" },
    { "name": "courierClaim", "type": "boolean", "description": "Ops-confirmed" },
    { "name": "opsCorrectedFields", "type": "string", "isArray": true, "description": "Which agent proposals ops changed. Feeds the agent-accuracy metric." },
    { "name": "rejectionReason", "type": "string", "description": "Required before status REJECTED. Customer-visible." }
  ]
}
```

- [ ] **Step 2: Write the `ReturnTimeline` schema**

Create `blocks/data/schemas/ReturnTimeline.json`:

```json
{
  "schemaName": "ReturnTimeline",
  "fields": [
    { "name": "returnId", "type": "string", "description": "ReturnCase.ItemId" },
    { "name": "customerItemId", "type": "string", "description": "Denormalised owner, for the row policy" },
    { "name": "at", "type": "date", "description": "When the customer was told" },
    { "name": "status", "type": "string", "description": "Status this entry records" },
    { "name": "message", "type": "string", "description": "Exactly what the customer was told" },
    { "name": "isCustomerVisible", "type": "boolean", "description": "False for internal entries" },
    { "name": "authorRole", "type": "string", "description": "system|ops|manager" }
  ]
}
```

- [ ] **Step 3: Validate locally**

```bash
blocks data validate --json
```

Expected: `{"ok": true, "errors": [], "schemaCount": 3}`.

- [ ] **Step 4: Dry-run and show the user**

```bash
blocks data sync --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Expected: `ReturnCase` and `ReturnTimeline` as creates, `Orders` unchanged. **Stop and get approval.**

- [ ] **Step 5: Apply after approval**

```bash
blocks data sync --project Df53833214f2a4243b696b55040b32509 --account default --yes --json
```

- [ ] **Step 6: Verify both schemas exist**

```bash
blocks data schema get-by-name ReturnCase --project Df53833214f2a4243b696b55040b32509 --account default --json
blocks data schema get-by-name ReturnTimeline --project Df53833214f2a4243b696b55040b32509 --account default --json
```

Expected: both return their full field lists. Confirm `aiReason` and `confirmedReason` are both present and distinct — the whole access model depends on them being separate columns.

- [ ] **Step 7: Commit**

```bash
git add blocks/data/schemas/
git commit -m "feat(data): ReturnCase and ReturnTimeline schemas"
```

---

### Task 3: `Inspection` and `Refund` schemas

**Files:**
- Create: `blocks/data/schemas/Inspection.json`
- Create: `blocks/data/schemas/Refund.json`

**Interfaces:**
- Consumes: `ReturnCase.ItemId` as `returnId`, `customerItemId` convention from Task 2.
- Produces: `Inspection` (customers get no grant on this schema at all) and `Refund` (`method`, `amount`, `reference`).

- [ ] **Step 1: Write the `Inspection` schema**

Create `blocks/data/schemas/Inspection.json`:

```json
{
  "schemaName": "Inspection",
  "fields": [
    { "name": "returnId", "type": "string", "description": "ReturnCase.ItemId" },
    { "name": "customerItemId", "type": "string", "description": "Denormalised owner" },
    { "name": "conditionOnArrival", "type": "string", "description": "GOOD|MINOR_DAMAGE|MAJOR_DAMAGE|UNUSABLE" },
    { "name": "restockable", "type": "boolean" },
    { "name": "faultAttribution", "type": "string", "description": "COURIER|SELLER|CUSTOMER" },
    { "name": "inspectorNotes", "type": "string", "description": "Internal. Customers have no grant on this schema." },
    { "name": "inspectedBy", "type": "string" },
    { "name": "inspectedAt", "type": "date" }
  ]
}
```

- [ ] **Step 2: Write the `Refund` schema**

Create `blocks/data/schemas/Refund.json`:

```json
{
  "schemaName": "Refund",
  "fields": [
    { "name": "returnId", "type": "string", "description": "ReturnCase.ItemId" },
    { "name": "customerItemId", "type": "string", "description": "Denormalised owner" },
    { "name": "method", "type": "string", "description": "BKASH|NAGAD|BANK" },
    { "name": "amount", "type": "number", "description": "Refunded amount in BDT" },
    { "name": "reference", "type": "string", "description": "Provider transaction reference, shown to the customer" },
    { "name": "paidAt", "type": "date" }
  ]
}
```

- [ ] **Step 3: Validate locally**

```bash
blocks data validate --json
```

Expected: `{"ok": true, "errors": [], "schemaCount": 5}`.

- [ ] **Step 4: Dry-run and show the user**

```bash
blocks data sync --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Expected: `Inspection` and `Refund` as creates. **Stop and get approval.**

- [ ] **Step 5: Apply after approval**

```bash
blocks data sync --project Df53833214f2a4243b696b55040b32509 --account default --yes --json
```

- [ ] **Step 6: Verify**

```bash
blocks data schema get-by-name Inspection --project Df53833214f2a4243b696b55040b32509 --account default --json
blocks data schema get-by-name Refund --project Df53833214f2a4243b696b55040b32509 --account default --json
```

- [ ] **Step 7: Commit**

```bash
git add blocks/data/schemas/
git commit -m "feat(data): Inspection and Refund schemas"
```

---

### Task 4: `PatternAlert` and `Decision` schemas

These two are management-only and answer the second half of the spec's acceptance question.

**Files:**
- Create: `blocks/data/schemas/PatternAlert.json`
- Create: `blocks/data/schemas/Decision.json`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond conventions.
- Produces: `PatternAlert` (`dimension`, `value`, `metric`, `threshold`, `takaImpact`, `contributingReturnIds`, `draftExplanation`, `raisedAt`) and `Decision` (`alertId`, `decisionType`, `target`, `status`). The manager dashboard plan reads both.

- [ ] **Step 1: Write the `PatternAlert` schema**

Create `blocks/data/schemas/PatternAlert.json`:

```json
{
  "schemaName": "PatternAlert",
  "fields": [
    { "name": "dimension", "type": "string", "description": "SKU|AREA|COURIER|REASON" },
    { "name": "value", "type": "string", "description": "e.g. SH-022, Mirpur, Sundarban Courier" },
    { "name": "metric", "type": "number", "description": "Observed rate as a percentage, e.g. 38" },
    { "name": "threshold", "type": "number", "description": "Threshold crossed, e.g. 30" },
    { "name": "takaImpact", "type": "number", "description": "Money lost attributable to this pattern, BDT" },
    { "name": "contributingReturnIds", "type": "string", "isArray": true },
    { "name": "draftExplanation", "type": "string", "description": "Agent-drafted likely cause" },
    { "name": "raisedAt", "type": "date", "description": "Must predate the manager opening the dashboard" },
    { "name": "acknowledgedBy", "type": "string" }
  ]
}
```

- [ ] **Step 2: Write the `Decision` schema**

Create `blocks/data/schemas/Decision.json`:

```json
{
  "schemaName": "Decision",
  "fields": [
    { "name": "alertId", "type": "string", "description": "PatternAlert.ItemId this decision answers" },
    { "name": "decisionType", "type": "string", "description": "SIZE_CHART_FIX|COURIER_CLAIM|COD_PAUSE|OTHER" },
    { "name": "target", "type": "string", "description": "What it applies to, e.g. SH-022 or Mirpur" },
    { "name": "note", "type": "string" },
    { "name": "decidedBy", "type": "string" },
    { "name": "decidedAt", "type": "date" },
    { "name": "status", "type": "string", "description": "OPEN|DONE" }
  ]
}
```

- [ ] **Step 3: Validate locally**

```bash
blocks data validate --json
```

Expected: `{"ok": true, "errors": [], "schemaCount": 7}`.

- [ ] **Step 4: Dry-run and show the user**

```bash
blocks data sync --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Expected: `PatternAlert` and `Decision` as creates. **Stop and get approval.**

- [ ] **Step 5: Apply after approval**

```bash
blocks data sync --project Df53833214f2a4243b696b55040b32509 --account default --yes --json
```

- [ ] **Step 6: Verify all seven schemas are live**

```bash
blocks data schema list --project Df53833214f2a4243b696b55040b32509 --account default --json
```

Expected: `"totalCount": 7` with `Orders`, `ReturnCase`, `ReturnTimeline`, `Inspection`, `Refund`, `PatternAlert`, `Decision`.

- [ ] **Step 7: Commit**

```bash
git add blocks/data/schemas/
git commit -m "feat(data): PatternAlert and Decision schemas"
```

---

### Task 5: IAM roles

**Files:**
- Create: `blocks/iam/roles.md` (a record of what was created and why — there is no local file format for roles; they live server-side)

**Interfaces:**
- Consumes: nothing.
- Produces: three role slugs — `customer`, `ops`, `manager` — referenced by every policy in Task 6.

- [ ] **Step 1: Record what already exists**

```bash
blocks iam roles list --project Df53833214f2a4243b696b55040b32509 --account default --json
```

Expected: the platform's seeded roles. Note their slugs — if a slug you intend to create already exists, use the existing one rather than creating a duplicate. Role hierarchy and permission assignment key off `slug`, not `itemId`.

- [ ] **Step 2: Dry-run the `customer` role**

```bash
blocks iam roles create --name "Customer" --slug customer \
  --description "End customer. Sees only their own returns." \
  --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

**Stop and show the user.** Confirm the flag names against `blocks help iam roles create --json` first — if a flag in this command is reported as unknown, the CLI will warn rather than fail, and the value would be silently dropped. Fix the command before the `--yes` run.

- [ ] **Step 3: Create `customer` after approval**

```bash
blocks iam roles create --name "Customer" --slug customer \
  --description "End customer. Sees only their own returns." \
  --project Df53833214f2a4243b696b55040b32509 --account default --yes --json
```

- [ ] **Step 4: Create `ops` — dry-run, approve, apply**

```bash
blocks iam roles create --name "Ops Staff" --slug ops \
  --description "Receives, inspects and decides returns. No analytics." \
  --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Then the same command with `--yes` after approval.

- [ ] **Step 5: Create `manager` — dry-run, approve, apply**

```bash
blocks iam roles create --name "Business Manager" --slug manager \
  --description "Pattern views, financial totals, decision log." \
  --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Then the same command with `--yes` after approval.

- [ ] **Step 6: Verify all three exist**

```bash
blocks iam roles list --project Df53833214f2a4243b696b55040b32509 --account default --json
```

Expected: `customer`, `ops`, `manager` present with the descriptions above.

- [ ] **Step 7: Write the record file**

Create `blocks/iam/roles.md` listing each slug, its display name, its description, and one line on what it may read and write per the spec's grant matrix. This exists because roles have no local file representation — without it the next person has to query the server to learn the intent.

- [ ] **Step 8: Commit**

```bash
git add blocks/iam/roles.md
git commit -m "feat(iam): customer, ops and manager roles"
```

---

### Task 6: Data access policies, and the test that proves they hold

This is the task the spec's security claim rests on. It begins with a probe because the `ruleGroup` shape is not documented anywhere in the CLI or its skills — do not invent it.

**Files:**
- Modify: `blocks/data/rules.json`

**Interfaces:**
- Consumes: all seven schema names from Tasks 1–4; role slugs `customer`, `ops`, `manager` from Task 5.
- Produces: the deployed policy set. No later task depends on its internal shape.

- [ ] **Step 1: Probe the canonical policy shape — author ONE policy and read it back**

Edit `blocks/data/rules.json` to hold a single, deliberately simple policy:

```json
{
  "policies": [
    {
      "schemaName": "ReturnCase",
      "policyName": "customer-reads-own-returns",
      "policyDescription": "A customer may read only rows whose customerItemId is their own user id.",
      "policyType": 1,
      "operation": "read",
      "isAllowPolicy": true,
      "priority": 10,
      "ruleGroup": {}
    }
  ]
}
```

- [ ] **Step 2: Validate, dry-run, and inspect what the CLI will send**

```bash
blocks data validate --json
blocks data rules deploy --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Read the dry-run body carefully. **Show it to the user.** If the dry-run or a subsequent deploy rejects `policyType`, `operation`, or the empty `ruleGroup`, that error message is the specification — it will name the field and the accepted values.

- [ ] **Step 3: Deploy the probe after approval, then pull it back**

```bash
blocks data rules deploy --project Df53833214f2a4243b696b55040b32509 --account default --yes --json
blocks data rules pull --project Df53833214f2a4243b696b55040b32509 --account default --json
blocks data rules policy get ReturnCase --project Df53833214f2a4243b696b55040b32509 --account default --json
```

**Record the canonical `ruleGroup` structure the server returns in a fenced block at the top of this task before continuing.** Specifically establish: can a rule reference the calling user's id directly (a token such as `CurrentUser` / `@me`), or must the value be supplied by the caller? Open question 3 in the spec is resolved here, and both answers are workable — but every remaining policy must be written against the real one.

- [ ] **Step 4: Write the failing access test**

With the probe policy live, verify the boundary actually exists before writing the rest. Create two test customers and one return owned by the first:

```bash
blocks iam users create --email shopreturn-customer-a@example.com --roles customer \
  --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Approve, apply with `--yes`, and repeat for `shopreturn-customer-b@example.com`. Then insert one `ReturnCase` row owned by customer A.

Expected at this point: querying that row **as customer B** returns it — the policy set is incomplete, so the boundary does not yet hold. Record the failing result. This is the test that must flip.

- [ ] **Step 5: Author the full policy set**

Using the confirmed `ruleGroup` shape, write every policy from the spec's grant matrix into `blocks/data/rules.json`:

- `ReturnCase`: customer read where `customerItemId` = caller; customer create; ops read/edit all; manager read all.
- `ReturnCase` field mask: deny `customer` read on `aiReason`, `aiConfidence`, `aiRestockable`, `aiCourierClaim`, `aiDraftMessage` via `fieldNames`.
- `ReturnTimeline`: customer read where `customerItemId` = caller **and** `isCustomerVisible` is true; ops read all + insert; manager read all. **No update or delete policy for any role** — the absence is what makes it append-only.
- `Inspection`: ops read/insert/edit; manager read. **No customer policy of any kind.**
- `Refund`: customer read where `customerItemId` = caller; ops read/insert; manager read.
- `PatternAlert`: manager read/edit only.
- `Decision`: manager read/insert/edit only.
- `Orders`: read-only for all three roles.

- [ ] **Step 6: Validate, dry-run, show the user, apply**

```bash
blocks data validate --json
blocks data rules deploy --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

**Stop for approval**, then:

```bash
blocks data sync --project Df53833214f2a4243b696b55040b32509 --account default --yes --json
```

`data sync` rather than `rules deploy` alone, so the reload runs and the policies actually go live.

- [ ] **Step 7: Run the access test again — it must now fail closed**

Repeat the Step 4 query as customer B against customer A's return.

Expected: **denied or empty.** Then verify each of these individually:

1. Customer A reads their own return — succeeds.
2. Customer A reads `aiReason` on their own return — masked or absent.
3. Customer A queries `Inspection` — denied.
4. Customer A queries `PatternAlert` — denied.
5. Ops updates a `ReturnTimeline` row — denied (append-only holds for ops too).
6. Manager reads `Decision` — succeeds.

If any of these six does not behave as stated, the policy set is wrong. Fix it and re-run all six. Do not proceed with a partially-holding boundary — every downstream plan assumes this task's guarantee.

- [ ] **Step 8: Commit**

```bash
git add blocks/data/rules.json
git commit -m "feat(data): server-enforced access policies for customer, ops and manager"
```

---

## Self-review notes

**Spec coverage.** §4 data model → Tasks 1–4 (all seven schemas). §5 access model → Tasks 5–6 (roles, grant matrix, the single field mask, the append-only absence). §9 open question 3 (`ruleGroup` shape) → resolved in Task 6 Step 3. §6 agent layer, §7 frontend, §8 demo script → **deliberately not in this plan**; they belong to the follow-on plans listed below.

**Deferred to later plans:** the app scaffold and customer portal with the intake agent; the ops console with the editable-sentence confirm screen; the manager dashboard, deterministic pattern detection, and the Pattern Watch agent; demo data seeding beyond the two test customers of Task 6.

**Known soft spots, stated rather than hidden:**
- Task 1 Step 7 and Task 6 Step 3 are genuine empirical probes. The field-type vocabulary and the `ruleGroup` structure are not documented in the CLI, its skills, or its agent guide, and inventing either would have produced a confidently wrong plan. Both steps say what to do with the answer.
- Task 5 Step 2 asks the executor to confirm `iam roles create` flag names against `blocks help` first. The CLI warns on an unknown flag rather than failing, so an invented flag name would be silently dropped and the role created without a description.
