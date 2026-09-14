# ShopReturn Customer Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in customer can see their own returns, open one and read the full record of what they were told and when, and submit a new return with photos — in the editorial "ledger" design, in Bangla or English.

**Architecture:** Four feature folders inside the scaffolded `app/`, all reading and writing through the existing `blocksClient` singleton. No new backend, no hand-written `fetch`. The access boundary proved in Plans 2–3 does the security work; the UI never filters for privacy, it only renders what the server already scoped.

**Tech Stack:** Vite + React + TypeScript (from `blocks new web`), `@seliseblocks/client` 0.2.0, Tailwind, the scaffold's own hand-rolled router and `useT()` i18n.

**Spec:** `docs/superpowers/specs/2026-09-14-shopreturn-design.md`
**Predecessors:** blocks-foundation, access-enforcement (8/9), customer-auth — all complete.
**Read before writing any data call:** `blocks/data/ACCESS-NOTES.md`.

## Why Task 1 is a verification, not a feature

Plan 3 ended with one thing unproven. The access boundary was established with **password-grant** tokens from `tools/access-check`; the app authenticates through **OIDC**. Identity claims match — the app's `iam.me()` returns byte-identical `UserId` to the suite's, and roles render as `customer` — but no data call has been made from the browser. Policy evaluation happens on the data plane, not at `iam.me()`.

So Task 1's list page is the proof: customer A must see exactly one return, with no `aiReason`. If that fails, nothing else in this plan should be built until it's understood.

## Global Constraints

- Work inside `D:\Construct\Hackathon_Blocks\app`. Run `npm run dev` from there; the app serves at `https://dbzjdy.slsblx.com:5173` (hosts entry + `npm run cert` already done).
- **Every Blocks call goes through `blocksClient`** from `src/lib/blocks/client.ts`. Never `fetch`, never `axios`, never a second client instance. `grep -rn "fetch(" src` must stay clean.
- **`blocks.data.collection(name)` takes the schema name** — `"ReturnCase"`, `"ReturnTimeline"`, `"Refund"`. Never the `blx_*` collection name.
- **Field selection is mandatory.** `list()` returns only `ItemId` unless you pass `fields`. Use `collection("ReturnCase", { fields: [...] })` or `.list({ fields: [...] })`. `ItemId` is always added for you.
- Response shape is GraphQL: `{ data: { getReturnCases: { items, totalCount, pageNo, pageSize, totalPages, hasNextPage, hasPreviousPage } } }`. Read `items` from there, not from a bare `items`.
- **The router is hand-rolled**, in `src/app/router/routes.tsx`: a `protectedRoutes` map of exact pathname → component, plus a `navigate()` that pushes state. There is no react-router and no path parameters. **Use a query string for detail views** (`/returns?id=…`), which the existing router already parses into `search`.
- Add nav entries to `src/app/layout/navItems.ts`.
- All user-facing strings go through `useT()` from `src/lib/i18n/LocalizationProvider`. No hardcoded English in JSX.
- **The UI must never filter for privacy.** The server already scopes every read. If a customer can see something they shouldn't, that is a policy bug to fix in `blocks/data/rules.json` — never a `.filter()` in a component.
- A 200 carrying `isSuccess: false` is a failure; a GraphQL 200 with a non-empty `errors` array is a failure.
- Never commit `app/.env` or `.cert/`. Both are already gitignored by the scaffold.
- After any change to `blocks/data/rules.json`, run `cd tools/access-check && node --env-file=.env assertions.mjs`. This plan should need no rules change — if you think you need one, say why first.

## What the customer may read (from the deployed policy set)

| Schema | Customer can |
|---|---|
| `ReturnCase` | read rows they created; create | 
| `ReturnTimeline` | read own rows where `isCustomerVisible` is true |
| `Refund` | read own rows |
| `Inspection`, `PatternAlert`, `Decision` | **nothing — 401** |
| `ReturnCase.aiReason`, `aiConfidence`, `aiRestockable`, `aiCourierClaim`, `aiDraftMessage` | **masked — absent from the response** |

Ownership for reads is **`CreatedBy`**, a server-set field. The customer must therefore create their own returns; a return created by ops is invisible to them. That is a known, accepted product constraint.

---

### Task 1: My Returns list — and the OIDC data-plane proof

**Files:**
- Create: `app/src/features/returns/useMyReturns.ts`
- Create: `app/src/features/returns/MyReturnsPage.tsx`
- Modify: `app/src/app/router/routes.tsx`
- Modify: `app/src/app/layout/navItems.ts`
- Modify: `app/blocks/localization/common.en.json`

**Interfaces:**
- Consumes: `blocksClient`, the scaffold's `useT()` and `shared/ui` components.
- Produces: `useMyReturns()` returning `{ returns, loading, error, refetch }`; route `/returns`. Tasks 2–3 reuse the hook and the route.

- [ ] **Step 1: Write the data hook**

`app/src/features/returns/useMyReturns.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";

export type ReturnRow = {
  ItemId: string;
  orderNumber?: string;
  sku?: string;
  productName?: string;
  status?: string;
  unitPrice?: number;
  rawCustomerText?: string;
  rejectionReason?: string;
};

// Only fields the customer is allowed to read. The ai* columns are masked by
// policy, so asking for them would either error or return null -- either way
// they must never appear in a customer view.
const FIELDS = [
  "orderNumber", "sku", "productName", "status",
  "unitPrice", "rawCustomerText", "rejectionReason"
];

export function useMyReturns() {
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await blocksClient.data
        .collection("ReturnCase", { fields: FIELDS })
        .list({ pageNo: 1, pageSize: 50 }) as {
          data?: { getReturnCases?: { items?: ReturnRow[] } };
        };
      setReturns(response?.data?.getReturnCases?.items ?? []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { returns, loading, error, refetch: load };
}
```

- [ ] **Step 2: Write the list page**

`app/src/features/returns/MyReturnsPage.tsx` — render one row per return showing order number, product name, status and age. Use the scaffold's existing `PageHeader`, `EmptyState`, `ErrorState`, `Skeleton` and `StatusPill` from `src/shared/ui/`; do not write new equivalents. Every label through `useT()`.

Each row links to `/returns?id=<ItemId>` via the router's `navigate()`. Task 2 builds that page.

- [ ] **Step 3: Register the route and nav item**

Add `"/returns": MyReturnsPage` to `protectedRoutes` in `routes.tsx`, and a nav entry in `navItems.ts` (`{ href: "/returns", labelKey: "nav.returns", icon: PackageOpen }` — `lucide-react` is already a dependency). Add the matching keys to `common.en.json`.

- [ ] **Step 4: THE PROOF — run it in the browser as customer A**

```bash
cd app && npm run dev
```

Sign in at `https://dbzjdy.slsblx.com:5173` as `shopreturn-customer-a@yopmail.com` and open `/returns`.

**Required observations, all four:**

1. Exactly **one** return is listed — the fixture, order `10-4821`.
2. Its fields are populated (product name, status), proving `fields` selection works.
3. Open devtools → Network → the GraphQL response for this call. **`aiReason` must not appear anywhere in the payload**, even though the row has one.
4. No console errors.

**If more than one return appears, or `aiReason` is present, STOP.** The boundary does not transfer from password-grant tokens to OIDC tokens, and that is a far more important finding than this page. Report it with the raw response and do not continue to Task 2.

Take a screenshot of the list for the record.

- [ ] **Step 5: Commit**

```bash
git add app/src/features/returns app/src/app/router/routes.tsx app/src/app/layout/navItems.ts app/blocks/localization/common.en.json
git commit -m "feat(portal): my returns list; proves the access boundary holds for OIDC tokens"
```

---

### Task 2: The design system and the ledger timeline

The spec's signature element. One motif, rendered here at its fullest density.

**Files:**
- Create: `app/src/app/ledger.css`
- Create: `app/src/features/returns/useReturnDetail.ts`
- Create: `app/src/features/returns/ReturnDetailPage.tsx`
- Modify: `app/src/app/styles.css` (import the new stylesheet)
- Modify: `app/src/app/router/routes.tsx`

**Interfaces:**
- Consumes: `useMyReturns` conventions from Task 1.
- Produces: `useReturnDetail(itemId)` returning `{ returnCase, timeline, refund, loading, error }`; route `/returns?id=…`.

- [ ] **Step 1: Write the design tokens**

`app/src/app/ledger.css` — the editorial direction agreed in design review:

```css
:root {
  --ledger-surface: #FBFAF7;   /* warm off-white */
  --ledger-ink: #14110E;       /* near-black */
  --ledger-muted: #7A7266;
  --ledger-faint: #9C9488;
  --ledger-rule: #E3DED4;      /* hairline */
  --ledger-band: #F5F2EA;      /* emphasis row */
  --ledger-good: #1F6F4A;      /* terminal/refunded */
  --ledger-warn: #B23A18;      /* rejected */
  --ledger-serif: Georgia, "Times New Roman", serif;
  --ledger-mono: ui-monospace, Menlo, Consolas, monospace;
}
```

Rules to follow throughout: **serif for prose, monospace for every timestamp, amount and reference.** Hairline rules, not boxes or shadows. Generous whitespace. Light mode only — this is shown on a projector, where contrast beats mood.

Import it from `src/app/styles.css`.

- [ ] **Step 2: Write the detail hook**

`useReturnDetail(itemId)` makes three calls through `blocksClient`:

1. `collection("ReturnCase", { fields: [...] }).get(itemId)` — same field list as Task 1.
2. `collection("ReturnTimeline", { fields: ["returnId","at","status","message","isCustomerVisible","authorRole"] }).list({ filter: { returnId: itemId }, sort: { at: 1 }, pageNo: 1, pageSize: 100 })`
3. `collection("Refund", { fields: ["returnId","method","amount","reference","paidAt"] }).list({ filter: { returnId: itemId }, pageNo: 1, pageSize: 5 })`

**`filter` and `sort` shapes are unverified** — the SDK types them as `Record<string, unknown> | string`. Try the object form first; if the server rejects it, read the error and try the string form, and **record the working shape in a comment at the top of the hook**. Later tasks and later plans will copy it.

Do **not** filter `isCustomerVisible` in the client — the policy already does. Request the field only so the UI can show it was considered.

Handle the empty-refund case: a return that is not yet refunded simply has no `Refund` row.

- [ ] **Step 3: Build the ledger**

`ReturnDetailPage.tsx`, following the agreed treatment:

- A header rule: `Return #<orderNumber>` on the left in serif, the status on the right in uppercase monospace, with a 2px bottom border in `--ledger-ink`.
- A small uppercase monospace label: "Record of updates".
- One row per timeline entry, in a two-column grid: a 74px monospace date/time column, then the message in serif at ~13.5px with 1.55 line-height. Each row separated by a 1px `--ledger-rule` top border.
- The terminal entry (refunded or rejected) gets `--ledger-band` background and a 2px `--ledger-ink` bottom border, and — when refunded — shows the amount in monospace with the reference beneath it in `--ledger-faint`.
- A rejection shows its `rejectionReason` in full. The spec requires the customer see the reason; never truncate it behind a "show more".

Read the customer's own words (`rawCustomerText`) into a quoted block above the record, styled with a 2px left border in `--ledger-rule` on `--ledger-band`.

- [ ] **Step 4: Register the route**

The router matches exact pathnames and exposes `search`. Handle `/returns?id=…` by rendering `ReturnDetailPage` when `id` is present and `MyReturnsPage` when it is not. Keep the change inside the existing `protectedRoutes` mechanism rather than restructuring the router.

- [ ] **Step 5: Verify in the browser**

As customer A, open the fixture return. Confirm: the timeline renders in chronological order; no `aiReason` or inspection detail appears anywhere; the page is legible at 1280px and at phone width.

Screenshot it — this is the screen the demo opens on.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/ledger.css app/src/app/styles.css app/src/features/returns app/src/app/router/routes.tsx
git commit -m "feat(portal): ledger timeline detail view in the editorial design system"
```

---

### Task 3: Submit a return, with photo evidence

**Files:**
- Create: `app/src/features/returns/useSubmitReturn.ts`
- Create: `app/src/features/returns/NewReturnPage.tsx`
- Modify: `app/src/app/router/routes.tsx`, `navItems.ts`, `common.en.json`

**Interfaces:**
- Consumes: `blocksClient`, `iam.me()` for the customer's own id.
- Produces: route `/returns/new`; a created `ReturnCase` at status `SUBMITTED`.

- [ ] **Step 1: Write the submit hook**

The form collects: order number, and the customer's own description (free text, Banglish welcome). It then creates a `ReturnCase` with:

- `customerItemId` — from `blocksClient.iam.me()`. **Set it even though `CreatedBy` is what the read policy uses.** `CreatedBy` is server-set and authoritative; `customerItemId` is the denormalised anchor the child-row policies key on, and ops tooling reads it. Both must agree.
- `orderNumber`, `rawCustomerText` from the form.
- `status`: exactly `"SUBMITTED"`.
- Leave every `ai*` and `confirmed*` field unset — those are the agent's and ops' columns respectively.

Look up the order first via `collection("Order", { fields: ["orderNumber","sku","productName","unitPrice","area","courier"] }).list({ filter: { orderNumber } })` and copy `sku`, `productName`, `unitPrice`, `area` and `courier` onto the return. If no order matches, show a clear error and do not create the return — a return with no order is not useful to ops.

- [ ] **Step 2: Add photo upload**

Use the SDK's storage surface, in this order:

```ts
const upload = await blocksClient.data.files.presignedUploadUrl({
  name: file.name,
  configurationName: "default",
  parentDirectoryId: "root",
  accessModifier: "Private"
});
await blocksClient.data.files.uploadToUrl({ url: upload.uploadUrl, body: file, contentType: file.type });
```

**Both shapes are unverified** — the README example is the only reference and `configurationName: "default"` may not exist on this project. Check with `blocks storage config list --project Df53833214f2a4243b696b55040b32509 --account default --json` **before** writing the code, and use a real configuration name. Record what you found.

Store the returned file ids in `ReturnCase.photoFileIds` (a String array).

If storage turns out not to be configured on this project, **say so and ship the form without photos** rather than faking it. Photos are one line of the spec; a broken upload path is worse than an absent one.

- [ ] **Step 3: Verify end to end as a real customer**

Sign in as customer A, submit a return against order `10-4821`, and confirm: it appears in `/returns`, its detail page renders, and `CreatedBy` is customer A (check via `blocks` CLI or the ops-side read).

Then sign in as **customer B** and confirm the new return is **not** visible. This is assertion 1 and 9 re-verified through the UI.

- [ ] **Step 4: Commit**

```bash
git add app/src/features/returns app/src/app/router/routes.tsx app/src/app/layout/navItems.ts app/blocks/localization/common.en.json
git commit -m "feat(portal): submit a return with photo evidence"
```

---

### Task 4: Bangla and English

**Files:**
- Create: `app/blocks/localization/common.bn.json`
- Modify: `app/blocks/localization/common.en.json`, `app/src/app/ledger.css`

**Interfaces:**
- Consumes: every `useT()` key added in Tasks 1–3.
- Produces: a working language switch covering the whole portal.

- [ ] **Step 1: Audit for hardcoded strings**

```bash
cd app && grep -rn ">[A-Z][a-z]" src/features/returns --include=*.tsx | grep -v "useT\|t(" | head -30
```

Every user-facing string must go through `useT()`. Fix any that do not.

- [ ] **Step 2: Add the Bangla dictionary**

Translate every key in `common.en.json` into `common.bn.json`. Keep status vocabulary as-is where the English term is what a Dhaka ops user would actually say; translate the customer-facing prose fully. This is the customer's portal and its users read Bangla.

- [ ] **Step 3: Add Bengali typography**

The editorial system uses Georgia, which has no Bengali coverage. Add a Bengali face — Hind Siliguri or Noto Sans Bengali — and set a font stack that falls through to it for Bengali codepoints. Load it from Google Fonts in `index.html`, and extend `--ledger-serif` accordingly.

Verify Bangla text renders with correct conjuncts and does not fall back to a system default that breaks the ledger's rhythm.

- [ ] **Step 4: Push the dictionaries to Blocks Localization**

```bash
blocks localization validate --json
blocks localization push --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Show the user, get approval, then `--yes`. Note the CLI merges cultures rather than replacing them — pushing `bn` will not wipe `en`.

- [ ] **Step 5: Verify and commit**

Switch languages in the running app using the scaffold's existing `LanguageSwitcher`. Confirm every screen from Tasks 1–3 renders in both. Screenshot the ledger in Bangla.

```bash
git add app/blocks/localization app/index.html app/src/app/ledger.css app/src/features
git commit -m "feat(portal): Bangla and English across the customer portal"
```

---

## Self-review notes

**Spec coverage.** §7 customer portal, the ledger timeline treatment, and the Bangla-first typography → Tasks 1–4. The spec's "submit a return in their own words" → Task 3, via a form. §5 access model → re-verified through the UI in Tasks 1 and 3.

**Deliberately deferred to Plan 5:** the intake agent. The spec's chosen design is agent-as-intake, and Task 3's form is *not* a replacement for it — it is the proven path that makes the portal demonstrable on its own, and the fallback if the agent misbehaves on stage. Plan 5 adds the agent as the primary intake surface, writing the same `ReturnCase` through tools carrying the customer's `hostToken`. Keeping the form is deliberate, not waste.

**Also deferred:** the ops console (Plan 6) and the manager dashboard with Pattern Watch (Plan 7).

**Known soft spots, stated rather than hidden:**
- Task 1 Step 4 may prove the boundary does not transfer to OIDC tokens. The plan stops there if so, because every later task assumes it does.
- Task 2 Step 2's `filter` and `sort` shapes are unverified; the SDK types them loosely and the plan says to record the working form for later reuse.
- Task 3 Step 2's storage config name is unverified and must be checked against `storage config list` before code is written. If storage is unconfigured, shipping without photos is the stated fallback.
- The hand-rolled router has no path parameters, so detail views use query strings. That is a scaffold constraint, not a design preference.
