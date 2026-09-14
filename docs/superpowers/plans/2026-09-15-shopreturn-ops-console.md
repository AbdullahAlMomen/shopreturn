# ShopReturn Ops Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ops staff can work a queue of returns: read what the customer wrote beside what the AI proposed, correct it, accept it — publishing the first customer-visible message — then record an inspection, issue a refund, or reject with a written reason.

**Architecture:** A new `ops` feature area in the existing scaffolded app, gated by the `ops` role, reading and writing through the same `blocksClient` singleton. No new schemas: everything this needs already exists and is already policy-enforced.

**Tech Stack:** Vite + React + TypeScript, `@seliseblocks/client` 0.2.0, the scaffold's hand-rolled router and `useT()` i18n.

**Spec:** `docs/superpowers/specs/2026-09-14-shopreturn-design.md`
**Predecessors:** blocks-foundation, access-enforcement, customer-auth, customer-portal — all complete. Suite at 10/11.
**Read before any data call:** `blocks/data/ACCESS-NOTES.md`.

## Why this is the demo's pivotal screen

The spec's hardest requirement to *show* is: *"Ops staff confirm or correct the categorization before it counts, and every customer message remains human-approved."* The design review chose the **editable sentence** treatment over a conventional form precisely because it makes that visible in one glance — the AI's reading rendered as prose with a human's hand on it.

This is also where the structural guarantee becomes observable: the agent writes `ai*` columns, ops writes `confirmed*` columns, and analytics read only the latter. An unreviewed guess cannot reach a customer or move a number.

## Global Constraints

- App at `D:\Construct\Hackathon_Blocks\app`, served at `https://dbzjdy.slsblx.com:5173`.
- **Every Blocks call through the `blocksClient` singleton.** No `fetch`, no second client. `grep -rn "fetch(" app/src` must stay clean of new hits.
- `blocks.data.collection(name)` takes the **schema name**. `list()` returns only `ItemId` unless `fields` is passed. `filter` and `sort` take the **object** form (`{ filter: { status: "SUBMITTED" } }`, `{ sort: { at: 1 } }`); a bare string `sort` returns 400. `get(itemId)` returns a **list envelope with one item**.
- **A 200 response can still be a failure.** A GraphQL `errors` array or a null mutation payload means it failed. This platform has produced four distinct shapes of this — check both before showing success.
- New i18n keys go in **all three** of `common.en.json`, `common.bn.json`, and `src/lib/i18n/dictionary.ts`. Key sets must stay identical (currently 71/71).
- The router is hand-rolled: exact pathname → component, no path parameters. Use query strings (`/ops/review?id=…`). Pages read `location.search` themselves; navigation uses `pushState` + a synthetic `popstate`.
- Role gating uses the existing `useRoles()` hook (`app/src/lib/blocks/useRoles.ts`), which reads the **JWT claim** — a flat string, not `iam.me()`'s object. Gate on the same value the server checks.
- **Client gating is UX, never security.** The server enforces. Never add a check that pretends to enforce.
- `npm run build` and `npm run lint` must both be clean. No `any` to silence tsc.
- Run `cd tools/access-check && node --env-file=.env assertions.mjs` after any change touching data or policies. Expect **10/11** (assertion 7 red by design). If any other number moves, stop.

## What ops may do (from the deployed policy set — verified)

| Schema | Ops can |
|---|---|
| `ReturnCase` | read all **including the `ai*` columns**, edit, delete |
| `ReturnTimeline` | read all, **insert only** — no update, no delete, for anyone |
| `Inspection` | read, insert, edit |
| `Refund` | read, insert |
| `Order` | read all |
| `PatternAlert`, `Decision` | **nothing** — management only |

`ReturnCase.orderNumber` is `isUniqueData: true`: one return per order, enforced by the database.

---

### Task 1: Seed a reviewable return, and build the ops queue

**Files:**
- Create: `app/src/features/ops/useOpsQueue.ts`
- Create: `app/src/features/ops/OpsQueuePage.tsx`
- Modify: `app/src/app/router/routes.tsx`, `app/src/app/layout/navItems.ts`, `app/src/app/layout/AppShell.tsx`
- Modify: the three i18n files

**Interfaces:**
- Produces: `useOpsQueue()` returning `{ returns, loading, error, refetch }`; route `/ops`. Task 2 reuses both.

- [ ] **Step 1: Seed a return that is actually awaiting review**

The only existing return is already `REFUNDED`, so the queue would be empty and the screen unverifiable. Customer A has two unclaimed orders (`10-4822`, `10-4823`).

Write a throwaway script under `.superpowers/sdd/2026-09-15-shopreturn-ops-console/` (not under `tools/access-check/`, which you must not modify). Signed in **as customer A**, create a return on `10-4822` — it must be created by the customer, because reads key on `CreatedBy`:

- `orderNumber` `10-4822`, and `sku`/`productName`/`unitPrice`/`area`/`courier` copied from that Order row
- `customerItemId` = customer A's itemId
- `status` `"SUBMITTED"`
- `rawCustomerText`: `"t-shirt ta onek boro hoye geche, exchange kora jabe?"`

Then, **as ops**, edit in the AI proposal that the intake agent would have written:
`aiReason` `"WRONG_SIZE"`, `aiConfidence` `0.79`, `aiRestockable` `true`, `aiCourierClaim` `false`, `aiDraftMessage` `"Thanks — we've received your exchange request and will check the item."`

Leave every `confirmed*` field **unset**. That is the point: this return is awaiting human review.

Record the new itemId in your report. Do not commit the script.

- [ ] **Step 2: Write the queue hook**

`useOpsQueue()` lists `ReturnCase` with the fields ops needs — including the `ai*` set, which ops may read and the customer may not. Sort newest first (`{ sort: { CreatedDate: -1 } }` — verify the descending value; if `-1` is rejected try `0`/`1` and record what works).

Do **not** filter by owner. Ops legitimately sees every return; the server already decides that.

- [ ] **Step 3: Build the queue page**

A dense list — this is a working tool, not a customer surface. Per row: order number, product, customer's raw text (truncated), the AI's proposed reason with its confidence, status, and age.

Make the **awaiting-review** state visually distinct: a return whose `confirmedReason` is null has not been touched by a human. That is the queue's whole purpose.

Use the `ledger.css` tokens so it belongs to the same system, but at roughly half the customer portal's vertical rhythm — the design agreed ops sees the same motif at higher density.

- [ ] **Step 4: Gate it to ops**

Add `/ops` to `protectedRoutes` and a nav entry visible only when `hasRole("ops")`. Guard the route itself too: a customer typing `/ops` gets a clear message naming their role, not a blank page or a policy error.

Manager is **not** granted the ops queue here — the spec keeps operational detail and analytics separate. If that turns out to be inconvenient later it is a deliberate choice to revisit, not an oversight.

- [ ] **Step 5: Verify and commit**

Build and lint clean; assertions still 10/11. Report what ops sees and what a customer sees at `/ops`.

```bash
git add app/src/features/ops app/src/app/router/routes.tsx app/src/app/layout app/blocks/localization app/src/lib/i18n/dictionary.ts
git commit -m "feat(ops): review queue gated to the ops role"
```

---

### Task 2: The editable sentence — confirm or correct

The screen the design review chose, and the one the demo turns on.

**Files:**
- Create: `app/src/features/ops/useReviewReturn.ts`
- Create: `app/src/features/ops/OpsReviewPage.tsx`
- Modify: `app/src/app/router/routes.tsx`, the three i18n files

**Interfaces:**
- Consumes: `useOpsQueue` conventions.
- Produces: route `/ops/review?id=…`; on accept, a `ReturnCase` with `confirmed*` set and one new customer-visible `ReturnTimeline` entry.

- [ ] **Step 1: Render the customer's words and the agent's reading**

Top: the customer's `rawCustomerText` verbatim, in the quoted block style the portal uses. **Never edit, translate or normalise it** — it is evidence.

Below it, the agent's reading as an editable sentence:

> This is a `[damaged in transit ▾]` return. The item is `[not restockable ▾]` and a courier claim is `[likely ▾]`.

Each bracketed part is a `<select>` inline in the prose, styled to read as part of the sentence — underlined, not boxed. Populate from the `ai*` values. Show `aiConfidence` nearby in monospace, small and unobtrusive.

Reason options, exactly: `DAMAGED_IN_TRANSIT`, `WRONG_SIZE`, `DEFECTIVE`, `COD_REFUSAL`, `CHANGED_MIND`, `LATE_DELIVERY`, `OTHER`. Display them in readable prose; store the exact enum strings.

- [ ] **Step 2: Record what ops changed**

When a select is changed from the AI's value, add that field name to `opsCorrectedFields` (a String array on `ReturnCase`). Leave it empty when ops accepts as-is.

This is the agent-accuracy metric. Store the field name, not the old value — the old value is still in the `ai*` column and always will be.

- [ ] **Step 3: Accept — write the confirmed columns and publish the message**

On accept, in this order:

1. Update `ReturnCase`: `confirmedReason`, `restockable`, `courierClaim`, `opsCorrectedFields`, and `status` `"ACCEPTED"`.
2. Insert a `ReturnTimeline` entry: `returnId`, `customerItemId` (copied from the return — child rows key on it, not on `CreatedBy`), `at` (now, ISO), `status` `"ACCEPTED"`, `isCustomerVisible: true`, `authorRole: "ops"`, and `message` — the text ops approved.

**The message field is pre-filled from `aiDraftMessage` but must be editable before it publishes.** That is the spec's "every customer message remains human-approved" made real: ops sees the draft, can change it, and what they send is what the customer reads.

Check both mutation responses for a GraphQL `errors` array before reporting success.

**If the timeline insert fails after the `ReturnCase` update succeeded**, say so explicitly in the UI. There is no transaction across the two, and a silent half-completion would leave a return marked accepted with nothing told to the customer — the exact failure this product exists to prevent.

- [ ] **Step 4: Reject — a written reason is mandatory**

A reject action sets `status` `"REJECTED"` and `rejectionReason`, and publishes a customer-visible timeline entry containing that reason.

**Refuse to submit with an empty reason.** The spec requires a written reason for any rejection, visible to the customer. Enforce it in the form, and state in your report that this is a UI-level rule — the server does not require it, so it is a convention this screen upholds rather than a guarantee.

- [ ] **Step 5: Verify and commit**

Verify headlessly, as Task 1 did: accept the seeded return through the same calls, confirm `confirmedReason` is set, `opsCorrectedFields` records the changed field, and a new customer-visible timeline entry exists. Then confirm **customer A can see that new entry** — it is the whole point.

Assertions still 10/11.

```bash
git commit -m "feat(ops): editable-sentence review; accept publishes the customer's first message"
```

---

### Task 3: Inspection, refund, and the rest of the status path

**Files:**
- Create: `app/src/features/ops/useInspection.ts`, `useRefund.ts`
- Create: `app/src/features/ops/OpsCasePage.tsx` (or extend `OpsReviewPage` — decide and say which)
- Modify: the three i18n files

**Interfaces:**
- Produces: the full `SUBMITTED → ACCEPTED → RECEIVED → INSPECTED → REFUND_PROCESSING → REFUNDED` path, each transition writing one customer-visible timeline entry.

- [ ] **Step 1: Record an inspection**

Form writing an `Inspection` row: `returnId`, `customerItemId`, `conditionOnArrival` (`GOOD` / `MINOR_DAMAGE` / `MAJOR_DAMAGE` / `UNUSABLE`), `restockable`, `faultAttribution` (`COURIER` / `SELLER` / `CUSTOMER`), `inspectorNotes`, `inspectedBy`, `inspectedAt`.

**`inspectorNotes` is internal.** Customers hold no grant on `Inspection` at all, so it is structurally invisible to them — but never copy its text into a timeline message, which *is* customer-visible. That distinction is the spec's "a rejected customer sees their reason, not the internal debate."

Moves status to `INSPECTED` and publishes a timeline entry in plain customer language.

- [ ] **Step 2: Issue a refund**

Form writing a `Refund` row: `returnId`, `customerItemId`, `method` (`BKASH` / `NAGAD` / `BANK`), `amount` (default to the return's `unitPrice`, editable), `reference`, `paidAt`.

Moves status to `REFUNDED` and publishes a timeline entry naming the amount, method and reference — the spec requires the refund record be visible to the customer on completion.

- [ ] **Step 3: Status transitions**

A small set of guarded actions rather than a free status dropdown: `Mark received` (→ `RECEIVED`), `Record inspection` (→ `INSPECTED`), `Start refund` (→ `REFUND_PROCESSING`), `Record refund` (→ `REFUNDED`), `Reject` (→ `REJECTED`).

Each writes exactly one timeline entry. Do not allow skipping to `REFUNDED` from `SUBMITTED` — the ledger is the product, and a case that teleports has no story to tell.

- [ ] **Step 4: Verify the whole path and commit**

Drive the seeded return from `ACCEPTED` to `REFUNDED` headlessly, then confirm as customer A that the ledger shows every step with a readable message and the refund record at the end.

Assertions still 10/11.

```bash
git commit -m "feat(ops): inspection, refund and guarded status transitions"
```

---

### Task 4: Assertions for the ops path

**Files:**
- Modify: `tools/access-check/assertions.mjs`

- [ ] **Step 1: Assertion 12 — a customer cannot write a timeline entry**

Signed in as customer A, attempt to insert a `ReturnTimeline` row for their own return. Passes when denied.

This matters: the timeline is the trust artifact. If a customer could append to it, the record of "what we told you" would no longer be the seller's word. Ops inserts; customers only read.

- [ ] **Step 2: Assertion 13 — ops cannot read PatternAlert or Decision**

Signed in as ops, list both. Passes when denied for each. The spec keeps financial totals and analytics for management; this proves the separation rather than assuming it.

- [ ] **Step 3: Run and commit**

Expect **12/13**, assertion 7 still red by design. If anything else moved, stop and report.

```bash
git commit -m "test(access-check): assertions 12-13 for the ops boundary"
```

---

## Self-review notes

**Spec coverage.** §6 ops guidance through inspection → Task 3. The "confirm or correct before it counts" requirement → Task 2. The append-only customer-visible record → Tasks 2 and 3, proven by assertion 12. Role separation → Task 1's gating and assertion 13.

**Deferred:** the manager dashboard and Pattern Watch (next plan); the intake agent (last). Order creation is explicitly parked at the user's request.

**Known soft spots, stated rather than hidden:**
- Task 1 Step 2's descending-sort value is unverified; the plan says to probe and record it.
- Task 2 Step 3 has no transaction across the two writes. The plan requires surfacing a half-completion rather than hiding it; a real fix would need server-side support that does not exist here.
- Task 2 Step 4's mandatory rejection reason is a UI convention, not a server guarantee. Stated as such so nobody later mistakes it for enforcement.
- The queue is ops-only by deliberate reading of the spec. If the demo wants a manager to watch the queue, that is a decision to make, not a bug to fix.
