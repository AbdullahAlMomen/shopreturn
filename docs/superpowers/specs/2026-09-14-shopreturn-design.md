# ShopReturn — Design Specification

**Date:** 2026-09-14
**Source requirement:** `05-ShopReturn.pdf` — "5. ShopReturn: Online Seller Returns and Refund Operations"
**Platform:** SELISE Blocks
**Project:** `ShopReturn` · tenantId `Df53833214f2a4243b696b55040b32509` · app domain `https://dbzjdy.slsblx.com` · single `dev` environment

---

## 1. Problem

A Dhaka F-commerce seller ships 400–500 orders/day, 60% cash-on-delivery, through a Facebook storefront and couriers. Returns run ~15%, costing ৳60–90k/month. Today they live in a notebook and the seller's memory. The quoted customer complaint is the product thesis:

> "nobody ever told me what happened to my refund."

Three people, three incompatible views of the same record:

| Role | Needs | Frustration today |
|---|---|---|
| Customer | Money or replacement, fast | Black hole after requesting a return |
| Ops staff | Receive, inspect, decide | No process; every case improvised |
| Business manager | Margins, courier negotiation, product mix | Can't see reasons or financial impact |

## 2. Delivery bar

**The scripted demo path, built deep and real, with deliberate platform breadth along it.**

The PDF contains both a *"Realistic demo case to script"* and a *"What great looks like"* acceptance question. Those are the rubric. The script already traverses Storage, IAM, Data, agents, analytics and notification, so depth on that path costs almost no breadth.

**Operating rule:** anything the demo path touches is genuinely real — server-enforced, no mocks. Anything it doesn't touch is not built.

Four areas are deliberately over-invested, because they are where competing submissions will lose points:

1. Access rules enforced in Blocks Data, not in React.
2. The decision log — half the acceptance question, and the first thing a rushed team cuts.
3. The append-only timeline — the spec names it "the trust artifact" twice.
4. The proactive pattern alert — the spec's stated "AI enhancement challenge".

## 3. Architecture

```
Customer portal (mobile-first SPA)
  └── Blocks Agents widget — Intake agent, Browser Integration WITH access token
         └── tools → Blocks Data (calls carry the customer's hostToken)

Ops console (desktop SPA)          Manager dashboard (desktop SPA)
  └── @seliseblocks/client            └── @seliseblocks/client
         └── Blocks Data / Storage / Notifier

Pattern detection: deterministic code on ops confirmation → writes PatternAlert
Pattern explanation: Pattern Watch agent drafts the likely cause
```

Everything runs on Blocks. No external LLM provider, no API key to protect, no second deploy target.

## 4. Data model — six schemas, plus one seeded support schema

Schemas are split along **access seams**, not by convenience. This makes most of the access rules fall out of schema boundaries rather than needing field-level masking.

The six below carry the product. A seventh, `Orders` (order number, SKU, product name, unit price, area, courier, customer), is seeded demo data that backs `lookupOrder` — it stands in for the seller's order system, which is out of scope. It is read-only to every role.

### 4.1 `ReturnCase`
The spine. Order ref, SKU, product name, unit price, area, courier, customer contact, raw customer text, photo file ids (Blocks Storage), status, `rejectionReason`.

The AI/human split is structural:

| Written by agent (never customer-visible) | Written by ops (drives everything downstream) |
|---|---|
| `aiReason`, `aiConfidence`, `aiRestockable`, `aiCourierClaim`, `aiDraftMessage` | `confirmedReason`, `restockable`, `courierClaim` |

Analytics read only `confirmed*`. An unreviewed AI guess therefore cannot reach a customer or move a number on the dashboard — the spec's "before it counts" rule is enforced by which column the query reads, not by a check we remember to write.

Also carries `opsCorrectedFields` (string list): which fields ops changed from the agent's proposal. Yields a real agent-accuracy metric for one extra column.

### 4.2 `ReturnTimeline`
The trust artifact. `customerItemId`, `returnId`, `at`, `status`, `message`, `isCustomerVisible`, `authorRole`.

**Insert-only for every role.** No update or delete grant exists for anyone, including ops, manager and the agent. A correction is a new entry.

### 4.3 `Inspection`
`returnId`, `customerItemId`, `conditionOnArrival`, `restockable`, `faultAttribution` (courier / seller / customer), `inspectorNotes`, `inspectedBy`, `inspectedAt`.

Customers have **no grant at all** on this schema — "inspection detail is internal" becomes structural rather than a masked field.

### 4.4 `Refund`
`returnId`, `customerItemId`, `method` (bKash / Nagad / bank), `amount`, `reference`, `paidAt`.

### 4.5 `PatternAlert`
`dimension` (sku / area / courier / reason), `value`, `metric`, `threshold`, `takaImpact`, `contributingReturnIds`, `draftExplanation`, `raisedAt`, `acknowledgedBy`.

### 4.6 `Decision`
`alertId`, `decisionType` (size-chart-fix / courier-claim / cod-pause / other), `target`, `note`, `decidedBy`, `decidedAt`, `status` (open / done).

### Status set

`SUBMITTED → ACCEPTED → RECEIVED → INSPECTED → REFUND_PROCESSING → REFUNDED`

with `REJECTED` as the alternate terminal, which cannot be entered without a written reason. Every transition writes exactly one `ReturnTimeline` entry carrying its customer-visible explanation.

### Ownership denormalisation

`CreatedBy` identifies the owner on `ReturnCase` only. A timeline entry written by ops has `CreatedBy = ops user`, so ownership cannot be derived from it — and we do not assume Blocks policies can express a join to the parent row. **Every child row carries an explicit `customerItemId`, stamped at write time**, so every policy is a single-row predicate.

## 5. Access model

Two enforcement layers: Data policies in `rules.json` (`ruleGroup` for rows, `fieldNames` for fields) and IAM permissions (type 1 `Endpoint` → 403 at the gateway; type 2 `FrontendAction` → control hidden in the SPA).

| Schema | `customer` | `ops` | `manager` |
|---|---|---|---|
| `ReturnCase` | read own rows, create | read all, edit | read all |
| `ReturnTimeline` | read own + `isCustomerVisible` | read all, insert | read all |
| `Inspection` | — | read, insert, edit | read all |
| `Refund` | read own, terminal only | read, insert | read all |
| `PatternAlert` | — | — | read, acknowledge |
| `Decision` | — | — | read, insert, edit |
| update / delete on `ReturnTimeline` | — | — | — |

**Field masking is used exactly once:** a DataProtection policy hides `aiReason`, `aiConfidence`, `aiRestockable`, `aiCourierClaim`, `aiDraftMessage` from `customer`. The customer owns that row, so without it they would read the unconfirmed AI guess. This is the spec's *"a rejected customer sees their reason, not the internal debate"* made literal.

Customer contact details need **no** masking rule, despite the requirement that they be internal. A customer reaches only their own row, so the contact data they can read is their own; ops and manager are both internal parties. The row policy already does the work.

**Verification moment for judges:** hand over the customer login and invite an attempt to fetch another customer's return, or their own `aiReason`, from devtools. The server refuses.

## 6. Agent layer

Two agents in Blocks Agents (per-project workspace, ShopReturn/dev), sharing a tool registry.

### 6.1 Intake agent — customer-facing

Embedded on the customer portal via **Browser Integration with an access token**, so tool calls carry the signed-in customer's `hostToken` and Data row policies still apply.

| Tool | Behaviour |
|---|---|
| `lookupOrder(orderNumber)` | Resolves SKU, courier, area before anything is extracted |
| `createReturn({orderNumber, rawText, aiReason, aiConfidence, aiRestockable, aiCourierClaim, aiDraftMessage})` | Writes one `ReturnCase` at `SUBMITTED` |
| `attachPhoto(returnId, fileId)` | Links an uploaded Blocks Storage file |
| `getMyReturns()` | Answers "what's happening with my refund?" from the customer's own rows |

**The intake agent has no grant on `ReturnTimeline`.** Its draft customer message lands in `ReturnCase.aiDraftMessage` and becomes a timeline entry only on ops approval. So *"every customer message remains human-approved"* is not a prompt instruction the model might drift from — the agent has no write path to what the customer reads. The only timeline entry its submission triggers is the factual system one ("return request received"), which asserts nothing.

Guardrails constrain `aiReason` to the enum and forbid promising any refund or outcome. Knowledge Base holds the seller's return policy so policy questions are answered grounded.

### 6.2 Pattern Watch agent — management-facing

**Detection is deterministic code; explanation is the agent.**

Threshold crossing is arithmetic over a `data schema aggregation` query. An LLM adds nothing and risks a wrong number in front of judges. After every ops confirmation — the moment a return counts — the app recomputes rates by SKU / area / courier / reason and writes a `PatternAlert` when a line is crossed.

The agent supplies `draftPatternExplanation(alert)` (reads contributing returns, drafts the likely cause) and `suggestDecisions(alert)`.

Two consequences: the alert's `raisedAt` provably predates the manager opening the dashboard, satisfying *"before the manager has to notice it on a dashboard"* demonstrably rather than rhetorically; and the critical path does not depend on programmatic agent invocation, which is unverified (see §9).

## 7. Frontend

### Design direction: editorial / document-like

The product's thesis is trust, and a ledger is culturally the form we already trust for money. Near-black ink on warm off-white, hairline rules, strong typographic hierarchy, one accent.

**Type system:** a serif for prose; monospace for every timestamp, amount and reference; Hind Siliguri or Noto Sans Bengali for Bangla, running alongside English via Blocks Localization. Light mode only — this will be shown on a projector, where contrast beats mood. Dark mode is out of scope.

**Chart palette** (validated with the dataviz validator, six checks passed against surface `#FBFAF7`): bars `#2563A8`, threshold breach `#B23A18`. CVD separation ΔE 21.1 (protan), normal-vision 27.4, contrast ≥3:1. Single-measure ranked bars, so no legend — each title names its series. Values direct-labelled. The breach carries the status colour **and** a "▲ over 30% threshold" label, never colour alone.

### The timeline is the motif

One element, three densities:

- **Customer** — *Ledger* treatment. Dated rows, hairline rules, monospace timestamps and amounts, the refund row weighted. The whole page.
- **Ops** — the same entries at roughly half the vertical rhythm, inside a dense queue.
- **Manager** — aggregated into flow.

### Three surfaces

| Surface | Shape |
|---|---|
| Customer portal | Mobile-first, single column, agent chat + ledger timeline |
| Ops console | Desktop. **Editable-sentence** confirm screen: the agent's reading rendered as prose corrected in place — *"This is a `damaged in transit ▾` return. The item is `not restockable ▾` and a courier claim is `likely ▾`."* Keyboard: ⏎ accept, ⌫ reject |
| Manager dashboard | **Answer-first**: opens with the acceptance question answered in prose, alert strip docked above, ranked bar facets as evidence, decision log on the same page |

The editable sentence is chosen over a conventional form because the spec's hardest requirement to *show* is "ops confirm or correct before it counts" — as prose with a human's hand on it, that is legible in one glance.

## 8. Demo script

1. Customer chats: *"order #10-4821 er shoe ta box chire geche, ekta shoe er sole alada hoye geche"* + photo → agent calls `lookupOrder`, then `createReturn` with `aiReason=DAMAGED_IN_TRANSIT`, `restockable=false`, `courierClaim=likely`
2. Ops console shows the AI reading beside the raw text → ops corrects one field, accepts → `confirmed*` written, first human-approved timeline entry published
3. Inspection recorded: courier's fault, not restockable
4. Refund ৳1,450 via bKash with reference → `REFUNDED`, customer sees it
5. That confirmation trips SH-022 past 38% → `PatternAlert` written, timestamped
6. Manager opens dashboard: alert already waiting, agent drafts the cause, manager records three `Decision` rows (size chart, courier claim, COD pause)

## 9. Open questions and risks

| # | Item | Handling |
|---|---|---|
| 1 | Can a Blocks Agents Tool call reliably produce well-formed structured arguments? | Guardrails + enum constraint. Mitigated structurally: ops confirm before anything counts, which the spec requires anyway |
| 2 | Can an agent be invoked programmatically (not via a chat turn)? Not found in the console. | Pattern detection is deterministic code, so the critical path does not need it. If it exists, explanation upgrades from on-view to at-detection |
| 3 | Can `ruleGroup` reference the calling user's id directly? | Verify against `blocks data rules pull` output on a real schema before authoring `rules.json`. If not, the predicate takes a passed value and query shapes change — policy still holds |
| 4 | Customer self-registration vs ops-created accounts | Assumption: self-signup enabled via `blocks iam signup-settings`, customers register with the phone/email on the order |
| 5 | `blocks new web --dry-run` is not a preview | Confirmed defect in CLI 0.5.0: `confirmMutation` early-returns on `--dry-run` and `new web` never branches on it, so `--dry-run` enables OIDC and creates an OIDC client with the confirmation skipped. Never use it as a preview here |

## 10. Out of scope

Dark mode · pagination polish and empty-state design beyond the demo path · multi-environment deploy (dev only) · courier system integration (couriers are a data field) · real payment execution (refund records the reference; no bKash API call) · customer notification channels beyond in-app (Notifier only; no SMS/WhatsApp) · order management (a seeded `Orders` schema backs `lookupOrder`).

---

## Decisions log

| Decision | Chosen | Rejected |
|---|---|---|
| Delivery bar | Scripted demo path, deep | Full spec demo-depth; full spec production-leaning |
| AI provider | Blocks Agents | Anthropic API + two-adapter hedge (dropped once Blocks Agents was found) |
| Agent role | Agent as customer intake | Ops assistant; both; form-first |
| Visual direction | Editorial / document-like | Operational-dense; warm consumer |
| Customer timeline | A · Ledger | B · Spine; C · Statement |
| Ops confirm screen | B · Editable sentence | A · Two-column; C · Queue triage |
| Manager dashboard | A · Answer-first + B's alert strip | B alone; C · KPI grid |
| Pattern detection | Deterministic code | Agent-judged thresholds |
