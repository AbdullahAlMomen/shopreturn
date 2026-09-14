# ShopReturn Manager Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the business manager a dashboard that answers *"which product, which area, and which reason is costing us the most — and what have we decided to do about it?"* from the same case data ops staff already enter.

**Architecture:** The manager surface is read-mostly. `Order` and `ReturnCase` are paged into the browser and reduced by a **pure, unit-tested function**, because the Blocks Data Gateway has no aggregate query. `PatternAlert` and `Decision` — collections only the manager can touch — drive an alert strip and a decision log. Before any of that, the ops queue is changed to ask the server for *open* cases, because the realistic dataset this dashboard needs would otherwise bury live work under seeded history.

**Tech Stack:** Vite 8.3 + React 18, TypeScript, `@seliseblocks/client` 0.2.0, `@tanstack/react-query` 5, `ledger.css` design tokens, **vitest 5** (added in Task 3), `lucide-react`. No charting library: the spec calls for single-measure ranked bars, which are CSS.

**Spec:** `docs/superpowers/specs/2026-09-14-shopreturn-design.md` — §7 "Three surfaces" (Manager dashboard: *answer-first*, alert strip docked above, ranked bar facets as evidence, decision log on the same page), the chart palette section, §8 demo steps 5–6.

**Source requirement:** `05-ShopReturn.pdf` — functional requirement 6 (*"pattern views: return rate by product, by area, by courier, by reason — with taka impact — early enough to act"*) and the success criterion quoted in the Goal. The manager never accepts or rejects refunds: *"Ops staff — receives, inspects, decides."*

## Global Constraints

- **The server is the only boundary.** Role gating in nav and pages is UX; `blocks/data/rules.json` enforces. Never filter for privacy in the UI.
- **Never trust a write's success message.** A `200` can carry `isSuccess: false`, or a GraphQL `errors` array with a null payload. Verify against the read path the consumer uses.
- **`401` is a denial; `400` is a malformed call.** Never record a `400` as an access-control result.
- **Row updates are positional:** `.update(itemId, fields)`. `{ filter, input }` returns `400`.
- **List sort is the object form** `{ CreatedDate: -1 }` (newest first). A bare string `400`s.
- **List filter is Mongo-style**, confirmed live: `{ status: { $nin: ["REFUNDED", "REJECTED"] } }` returns only non-terminal cases.
- **Status vocabulary:** `SUBMITTED`, `ACCEPTED`, `REJECTED`, `RECEIVED`, `INSPECTED`, `REFUND_PROCESSING`, `REFUNDED`. Terminal: `REFUNDED`, `REJECTED`.
- **Reason vocabulary:** `DAMAGED_IN_TRANSIT`, `WRONG_SIZE`, `DEFECTIVE`, `LATE_DELIVERY`, `COD_REFUSAL`, `CHANGED_MIND`, `OTHER`. Labels already exist as `ops.review.reason.<CODE>` — reuse them.
- **i18n keys must exist in all three files** or the UI renders `[ KEY MISSING ]`: `app/blocks/localization/common.en.json`, `app/blocks/localization/common.bn.json`, `app/src/lib/i18n/dictionary.ts`. Culture codes are `en-US` / `bn-BD`. `t()` has no interpolation — placeholders are filled with `.replace("{name}", value)`.
- **Never run `blocks localization pull`** — it overwrites local dictionaries with `{}`.
- **Secrets live only in `tools/access-check/.env`** (gitignored). Never in reports, commits, `.env.example`, command lines, or chat. Never print token values — length only.
- **Every cloud mutation: `--dry-run` first, show the user, get approval, then `--yes`.**
- `npm run lint` (tsc --noEmit), `npm run build`, and from Task 3 on `npm test`, must all be clean. No `any`.
- Manager grants, confirmed live 2026-09-15: reads `Order` / `ReturnCase` / `Refund` / `PatternAlert` / `Decision`; inserts and edits `Decision`; edits `PatternAlert`. **Cannot** edit `ReturnCase` (`401`) or delete `Decision` (`401`). Ops **cannot** read `PatternAlert` (`401`). Ops **can** create `Order`.

## Existing fixtures this plan must respect

| Order | SKU | Product | ৳ | Area / courier | ReturnCase |
|---|---|---|---|---|---|
| 10-4821 | SH-022 | Canvas Sneaker | 1450 | Mirpur 11 / Sundarban Courier | REFUNDED, DAMAGED_IN_TRANSIT (customer A) |
| 10-4822 | TS-104 | Cotton T-Shirt | 890 | Mirpur 11 / Sundarban Courier | REFUNDED, DEFECTIVE (customer A) |
| 10-4823 | DR-051 | Linen Dress | 2150 | Mirpur 11 / Sundarban Courier | REFUND_PROCESSING, DEFECTIVE (customer A) |
| 10-5001 | SH-022 | Canvas Sneaker | 1450 | Uttara / Paperfly | — (customer B) |
| 10-4824 | DN-114 | Slim Fit Denim | 2890 | Dhanmondi 27 / Pathao Courier | — (customer A, eligible for demo) |
| 10-4825 | BG-007 | Leather Tote Bag | 4250 | Gulshan 2 / RedX | — (customer A, eligible for demo) |

Plus one `PatternAlert` (`SKU` / `SH-022`, `metric: 38`, `threshold: 30`, `takaImpact: 44950`, `acknowledgedBy: ""`) and two `Decision` rows (`COURIER_CLAIM`, `SIZE_CHART_FIX`, both `OPEN`).

---

## File Structure

| File | Responsibility |
|---|---|
| `app/src/features/ops/useOpsQueue.ts` | **Modify.** Server-side open/all scope. |
| `app/src/features/ops/OpsQueuePage.tsx` | **Modify.** Open / all-recent toggle. |
| `tools/access-check/make-seed-user.mjs` | **Create.** Generates the seed account's secret into `.env` and a request body file, printing neither. |
| `tools/access-check/redact-json.mjs` | **Create.** Strips password fields from CLI dry-run output before it is shown. |
| `tools/access-check/seed-analytics.mjs` | **Create.** Tops the dataset up to per-SKU targets. |
| `tools/access-check/verify-analytics.mjs` | **Create.** Checks the seeded reality as the manager sees it. |
| `app/src/features/insights/analytics.ts` | **Create.** Pure aggregation: facets, rates, taka impact, ranking, headline. |
| `app/src/features/insights/analytics.test.ts` | **Create.** vitest tests for the maths. |
| `app/src/features/insights/useInsights.ts` | **Create.** Pages `Order` + `ReturnCase`, feeds `analytics.ts`. |
| `app/src/features/insights/InsightsPage.tsx` | **Create.** Role gate, answer-first headline, composition. |
| `app/src/features/insights/FacetBars.tsx` | **Create.** One ranked, direct-labelled bar group. |
| `app/src/features/insights/useAlerts.ts` | **Create.** PatternAlert read + acknowledge. |
| `app/src/features/insights/useDecisions.ts` | **Create.** Decision read + record + complete. |
| `app/src/features/insights/AlertStrip.tsx` | **Create.** Alerts as sentences, draft labelled as draft. |
| `app/src/features/insights/DecisionLog.tsx` | **Create.** Decision list + record form. |
| `app/scripts/i18n-parity.mjs` | **Create.** Key-set parity check across the three dictionaries. |
| `app/src/app/router/routes.tsx`, `app/src/app/layout/navItems.ts` | **Modify.** `/insights`, manager-gated. |
| `app/src/app/ledger.css` | **Modify.** Queue toggle, bars, strip, log. |
| i18n files (three) | **Modify.** All new keys, added once in Task 4. |
| `tools/access-check/assertions.mjs` | **Modify.** Assertions 12–14. |

---

### Task 1: Keep the ops queue about open work

The queue lists the newest 50 cases. Task 2 creates 65 terminal cases; without this task, every case that was open before seeding falls off the queue — including any you submitted while testing accept/reject. A queue is for work that is still open, so ask the server for exactly that, and keep history one click away.

**Files:**
- Modify: `app/src/features/ops/useOpsQueue.ts`
- Modify: `app/src/features/ops/OpsQueuePage.tsx`
- Modify: `app/src/app/ledger.css`

**Interfaces:**
- Consumes: `blocksClient`.
- Produces: `type QueueScope = "open" | "all"`; `useOpsQueue(scope: QueueScope)` returning the same `{ returns, loading, error, refetch }` as today.

- [ ] **Step 1: Prove the filter headlessly before touching the app**

Create `tools/access-check/queue-scope-check.mjs`:

```javascript
import { signIn } from './client.mjs';

const TERMINAL = ['REFUNDED', 'REJECTED'];
const { blocks: ops } = await signIn(process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD);

async function list(filter) {
  const res = await ops.data.collection('ReturnCase', { fields: ['orderNumber', 'status'] })
    .list({ pageNo: 1, pageSize: 100, sort: { CreatedDate: -1 }, ...(filter ? { filter } : {}) });
  return res?.data?.getReturnCases?.items ?? [];
}

const all = await list();
const open = await list({ status: { $nin: TERMINAL } });
const expected = all.filter((row) => !TERMINAL.includes(row.status)).map((row) => row.orderNumber).sort();
const actual = open.map((row) => row.orderNumber).sort();
const same = JSON.stringify(expected) === JSON.stringify(actual);
console.log(`all=${all.length} open=${open.length} expectedOpen=${expected.length}`);
console.log(same ? 'PASS open filter matches client-side expectation' : `FAIL expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
process.exit(same ? 0 : 1);
```

Run: `cd tools/access-check && node --env-file=.env queue-scope-check.mjs`
Expected: `PASS`. Today that is `all=3 open=1` (only `10-4823`), plus any cases submitted since.

- [ ] **Step 2: Add the scope to `useOpsQueue.ts`**

Replace the exported hook (keep the existing `OpsReturnRow`, `FIELDS`, and header comments) with:

```typescript
export type QueueScope = "open" | "all";

// Terminal statuses leave the default queue: a refunded or rejected case is
// history, not work. Filtered server-side (Mongo-style $nin, confirmed live)
// rather than client-side, because the queue fetches one page -- filtering
// that page in the browser would still let open cases fall off its end.
// $nin also matches rows with no status at all, which is what we want: a
// case in an unexpected state should surface, not vanish.
const TERMINAL_STATUSES = ["REFUNDED", "REJECTED"];

export function useOpsQueue(scope: QueueScope) {
  const [returns, setReturns] = useState<OpsReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await blocksClient.data
        .collection("ReturnCase", { fields: FIELDS })
        .list({
          pageNo: 1,
          pageSize: 50,
          sort: { CreatedDate: -1 },
          ...(scope === "open" ? { filter: { status: { $nin: TERMINAL_STATUSES } } } : {})
        }) as {
          data?: { getReturnCases?: { items?: OpsReturnRow[] } };
        };
      setReturns(response?.data?.getReturnCases?.items ?? []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { void load(); }, [load]);

  return { returns, loading, error, refetch: load };
}
```

- [ ] **Step 3: Add the toggle to `OpsQueuePage.tsx`**

Add `import { useState } from "react";` and `import type { QueueScope } from "./useOpsQueue";`. Replace `const { returns, loading, error, refetch } = useOpsQueue();` with:

```typescript
  const [scope, setScope] = useState<QueueScope>("open");
  const { returns, loading, error, refetch } = useOpsQueue(scope);
```

**Hook order matters:** these lines must stay above the `rolesLoading` and `!hasRole("ops")` early returns, exactly where the `useOpsQueue()` call is today.

Replace the `PageHeader`'s `actions` prop with:

```tsx
        actions={
          <div className="ops-scope" role="group" aria-label={t("ops.scope.label")}>
            {(["open", "all"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={scope === option ? "ops-scope-option ops-scope-option-active" : "ops-scope-option"}
                aria-pressed={scope === option}
                onClick={() => setScope(option)}
              >
                {t(option === "open" ? "ops.scope.open" : "ops.scope.all")}
              </button>
            ))}
            <ActionButton variant="icon" onClick={() => refetch()} title={t("common.refresh")} icon={<RefreshCw size={18} />} />
          </div>
        }
```

- [ ] **Step 4: Add the three keys**

These three keys are needed now for the page to compile, because `t()` takes a typed `TranslationKey`. Add them to all three i18n files in this task. Task 4 pushes them to the cloud.

| Key | en | bn |
|---|---|---|
| `ops.scope.label` | Show | দেখান |
| `ops.scope.open` | Open | খোলা |
| `ops.scope.all` | All recent | সাম্প্রতিক সব |

- [ ] **Step 5: Style the toggle** — append to `app/src/app/ledger.css`:

```css
/* ---- Ops queue scope toggle ------------------------------------------ */
.ops-scope { align-items: center; display: flex; gap: 6px; }
.ops-scope-option {
  background: transparent; border: 1px solid var(--ledger-rule); border-radius: 2px;
  color: var(--ledger-muted); cursor: pointer; font-family: var(--ledger-mono);
  font-size: 12px; letter-spacing: 0.04em; padding: 6px 10px;
}
.ops-scope-option-active { border-color: var(--ledger-ink); color: var(--ledger-ink); font-weight: 600; }
```

- [ ] **Step 6: Verify in the browser as ops**

At `https://dbzjdy.slsblx.com:5173/ops`: **Open** is selected by default and shows `10-4823` plus any case still under review; **All recent** also shows the refunded cases. Opening a case from either view still reaches `/ops/review?id=…`.

- [ ] **Step 7: Lint, build, commit**

```bash
cd app && npm run lint && npm run build
cd .. && git add app/src/features/ops/useOpsQueue.ts app/src/features/ops/OpsQueuePage.tsx app/src/app/ledger.css app/src/lib/i18n/dictionary.ts app/blocks/localization tools/access-check/queue-scope-check.mjs
git commit -m "feat(ops): queue shows open work by default, filtered server-side"
```

---

### Task 2: Seed a dataset the dashboard can say something about

Six orders and three cases cannot show a return *rate* by anything. The requirement's own scenario is 31 returns for one SKU. This task makes the PDF's numbers reproducible from real rows, created through the same API and grants the app uses.

**Targets** — totals *including* the existing fixtures. Taka impact is Σ unit price of returned items; 31 × ৳1450 = ৳44,950, which is why the fixture alert already says `44950`:

| SKU | Product | ৳ | Orders | Returns | Rate | Taka impact | Mirpur 11 + Sundarban returns |
|---|---|---|---|---|---|---|---|
| SH-022 | Canvas Sneaker | 1450 | 82 | 31 | 37.8% | 44,950 | **24** |
| DN-114 | Slim Fit Denim | 2890 | 55 | 11 | 20.0% | 31,790 | — |
| DR-051 | Linen Dress | 2150 | 64 | 9 | 14.1% | 19,350 | — |
| TS-104 | Cotton T-Shirt | 890 | 120 | 14 | 11.7% | 12,460 | — |
| BG-007 | Leather Tote Bag | 4250 | 40 | 3 | 7.5% | 12,750 | — |

**Totals:** 361 orders, 68 returns, 18.8%, ৳121,300. `BG-007` outranks `TS-104` on money while ranking last on rate — that inversion is the argument for "with taka impact", so keep it.

**Why the seeder tops up deficits instead of seeding fixed counts:** SH-022 already has 2 orders and 1 return, and that return is already Mirpur/Sundarban/damaged. Fixed counts would land at 83/32 and break the alert's 38%.

**Why SKUs and labels are these exact strings:** the existing T-shirt is `TS-104` and the dress `DR-051`; the existing labels are `Uttara` and `Paperfly`. Any near-duplicate (`TS-118`, `Uttara 7`) splits one bar into two.

**Files:**
- Create: `tools/access-check/make-seed-user.mjs`, `tools/access-check/redact-json.mjs`, `tools/access-check/seed-analytics.mjs`, `tools/access-check/verify-analytics.mjs`
- Modify: `tools/access-check/.env.example` (key names only)

**Interfaces:**
- Consumes: `signIn(email, password)` → `{ blocks, token }` from `tools/access-check/client.mjs`.
- Produces: rows only.

- [ ] **Step 1: Snapshot the customer demo before touching anything**

Sign in as customer A and record their visible order numbers, eligible order numbers (orders without a case), and return count. Save the output in the task report. Step 8 compares against it — do not assume today's numbers, because the user may have submitted returns while testing.

- [ ] **Step 2: Create the seed customer's secret without exposing it**

Returns are created by customers (the grant matrix gives ops no insert on `ReturnCase`). A dedicated seed customer keeps 65 seeded returns out of every demo account's "My returns".

Create `tools/access-check/make-seed-user.mjs`:

```javascript
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Generates the seed account's password straight into .env and writes the
// only secret-bearing request field to a temp file. Prints the file path and
// nothing else, so the password never reaches a terminal, a transcript, or a
// command line.
const envUrl = new URL('./.env', import.meta.url);
const EMAIL = 'shopreturn-seed@yopmail.com';

let password = process.env.SHOPRETURN_SEED_PASSWORD;
if (!password) {
  password = `Sd7!${randomBytes(12).toString('base64url')}`;
  const env = readFileSync(envUrl, 'utf8');
  appendFileSync(envUrl, `${env.endsWith('\n') ? '' : '\n'}SHOPRETURN_SEED_EMAIL=${EMAIL}\nSHOPRETURN_SEED_PASSWORD=${password}\n`);
}

const bodyPath = join(tmpdir(), 'shopreturn-seed-user.json');
writeFileSync(bodyPath, JSON.stringify({ password }));
console.log(bodyPath);
```

Create `tools/access-check/redact-json.mjs`:

```javascript
// Reads JSON on stdin and prints it with every password-like field replaced.
// Used on CLI dry-run output, which echoes the request body verbatim.
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const redact = (value) => {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) =>
        [key, /password/i.test(key) ? '<redacted>' : redact(inner)]));
    }
    return value;
  };
  try { console.log(JSON.stringify(redact(JSON.parse(input)), null, 2)); }
  catch { console.log('<non-JSON output suppressed: it may contain the password>'); }
});
```

Run: `cd tools/access-check && node --env-file=.env make-seed-user.mjs`
Expected: a single temp file path. Add `SHOPRETURN_SEED_EMAIL=shopreturn-seed@yopmail.com` and `SHOPRETURN_SEED_PASSWORD=` (empty) to `.env.example`.

- [ ] **Step 3: Create and activate the account — dry-run, show, approve**

```bash
blocks iam users create --email shopreturn-seed@yopmail.com --first-name Seed --last-name Account --roles customer --file "<path from Step 2>" --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json | node redact-json.mjs
```

Confirm the redacted request contains `email`, `roles: ["customer"]` **and** a `password` key (shown as `<redacted>`) — that proves the flags and the file merged. Show the user, get approval, re-run with `--yes` in place of `--dry-run` (still piped through `redact-json.mjs`), then note the returned user id and delete the temp file.

```bash
blocks iam users activate <userId> --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Show, approve, `--yes`. Then prove the login works, printing only the token length:

```bash
node --env-file=.env -e "import('./client.mjs').then(async ({ signIn }) => { const { token } = await signIn(process.env.SHOPRETURN_SEED_EMAIL, process.env.SHOPRETURN_SEED_PASSWORD); console.log('seed login ok, token length', token.length); })"
```

- [ ] **Step 4: Write the seeder**

Create `tools/access-check/seed-analytics.mjs`:

```javascript
import { signIn } from './client.mjs';

const TARGETS = [
  { sku: 'SH-022', productName: 'Canvas Sneaker',   unitPrice: 1450, orders: 82,  returns: 31, hot: 24 },
  { sku: 'DN-114', productName: 'Slim Fit Denim',   unitPrice: 2890, orders: 55,  returns: 11, hot: 0 },
  { sku: 'DR-051', productName: 'Linen Dress',      unitPrice: 2150, orders: 64,  returns: 9,  hot: 0 },
  { sku: 'TS-104', productName: 'Cotton T-Shirt',   unitPrice: 890,  orders: 120, returns: 14, hot: 0 },
  { sku: 'BG-007', productName: 'Leather Tote Bag', unitPrice: 4250, orders: 40,  returns: 3,  hot: 0 }
];

// The concentration the requirement describes: "24 of 31 returns from Mirpur
// via one courier".
const HOT = { area: 'Mirpur 11', courier: 'Sundarban Courier', reason: 'DAMAGED_IN_TRANSIT' };

// Orders that were NOT returned spread across every area and courier,
// including Mirpur 11 / Sundarban -- otherwise Mirpur's area rate would be
// ~100% and read as fabricated. Returned rows that are not "hot" avoid that
// pair, so the 24 stays exactly 24.
const ALL_AREAS = ['Mirpur 11', 'Dhanmondi 27', 'Gulshan 2', 'Uttara', 'Bashundhara'];
const ALL_COURIERS = ['Sundarban Courier', 'Pathao Courier', 'RedX', 'Paperfly', 'eCourier'];
const QUIET_AREAS = ['Dhanmondi 27', 'Gulshan 2', 'Uttara', 'Bashundhara'];
const QUIET_COURIERS = ['Pathao Courier', 'RedX', 'Paperfly', 'eCourier'];
const SPREAD_REASONS = ['WRONG_SIZE', 'CHANGED_MIND', 'DEFECTIVE', 'LATE_DELIVERY', 'COD_REFUSAL'];

// What customers actually write -- Banglish and English -- so the ops queue's
// "All recent" view reads like a real seller's history, not a fixture dump.
const TEXTS = {
  DAMAGED_IN_TRANSIT: ['Box chire geche, ekta shoe er sole alada hoye geche.', 'Parcel arrived crushed and the sole had come off.'],
  WRONG_SIZE: ['Size choto hoye geche, ek size boro lagbe.', 'Too tight around the toes, I need one size up.'],
  CHANGED_MIND: ['Mon bodle geche, ferot dite chai.', 'Found something that suits me better, want to return it.'],
  DEFECTIVE: ['Prothom din e selai khule geche.', 'The zip stopped working after one use.'],
  LATE_DELIVERY: ['Delivery onek late, occasion shesh hoye geche.', 'It arrived nine days late, after I needed it.'],
  COD_REFUSAL: ['Order ta ami kori nai, taka dei nai.', 'Refused at the door, the colour was not what I ordered.']
};

// Deterministic: a re-run produces the same shape, so reported numbers stay
// reproducible. Never Math.random() in a fixture.
const pick = (list, n) => list[n % list.length];

async function listAll(blocks, schema, fields) {
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await blocks.data.collection(schema, { fields }).list({ pageNo: page, pageSize: 100 });
    const items = res?.data?.[`get${schema}s`]?.items ?? [];
    rows.push(...items);
    if (items.length < 100) break;
  }
  return rows;
}

function failedWrite(res, field) {
  const payload = res?.data?.[field];
  return (Array.isArray(res?.errors) && res.errors.length > 0) || !payload?.itemId || payload.acknowledged === false;
}

const { blocks: ops } = await signIn(process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD);
const { blocks: seed } = await signIn(process.env.SHOPRETURN_SEED_EMAIL, process.env.SHOPRETURN_SEED_PASSWORD);

const orders = await listAll(ops, 'Order', ['orderNumber', 'sku']);
const cases = await listAll(ops, 'ReturnCase', ['orderNumber', 'sku', 'area', 'courier']);
const usedNumbers = new Set(orders.map((row) => row.orderNumber));

let seq = 0;
function nextOrderNumber() {
  let candidate;
  do { seq += 1; candidate = `20-${String(seq).padStart(4, '0')}`; } while (usedNumbers.has(candidate));
  usedNumbers.add(candidate);
  return candidate;
}

let madeOrders = 0;
let madeCases = 0;
let cursor = 0;

for (const target of TARGETS) {
  const skuCases = cases.filter((row) => row.sku === target.sku);
  const hotHave = skuCases.filter((row) => row.area === HOT.area && row.courier === HOT.courier).length;
  const ordersNeeded = Math.max(0, target.orders - orders.filter((row) => row.sku === target.sku).length);
  const returnsNeeded = Math.max(0, target.returns - skuCases.length);
  const hotNeeded = Math.max(0, target.hot - hotHave);

  if (returnsNeeded > ordersNeeded || hotNeeded > returnsNeeded) {
    // Refuse rather than improvise: seeding past this point would silently
    // miss the targets the verify step checks.
    throw new Error(`${target.sku}: cannot reach targets (orders+${ordersNeeded}, returns+${returnsNeeded}, hot+${hotNeeded}). Report; do not adjust targets.`);
  }
  console.log(`${target.sku}: +${ordersNeeded} orders, +${returnsNeeded} returns (+${hotNeeded} hot)`);

  for (let i = 0; i < ordersNeeded; i += 1) {
    cursor += 1;
    const isReturn = i < returnsNeeded;
    const isHot = i < hotNeeded;
    const area = isHot ? HOT.area : isReturn ? pick(QUIET_AREAS, cursor) : pick(ALL_AREAS, cursor);
    const courier = isHot ? HOT.courier : isReturn ? pick(QUIET_COURIERS, cursor + 1) : pick(ALL_COURIERS, cursor + 2);
    const orderNumber = nextOrderNumber();
    const common = { orderNumber, sku: target.sku, productName: target.productName, unitPrice: target.unitPrice, area, courier };

    // customerItemId is deliberately not a real user id: customer-reads-own-
    // orders matches it against UserId, so no customer's eligible-orders
    // dropdown can ever show these, while staff-reads-all-orders still does.
    const orderRes = await ops.data.collection('Order').create({ ...common, customerItemId: 'seed-synthetic', customerEmail: 'shopreturn-seed@yopmail.com' });
    if (failedWrite(orderRes, 'insertOrder')) throw new Error(`insertOrder ${orderNumber}: ${JSON.stringify(orderRes).slice(0, 200)}`);
    madeOrders += 1;

    if (isReturn) {
      const reason = isHot ? HOT.reason : pick(SPREAD_REASONS, cursor);
      const caseRes = await seed.data.collection('ReturnCase').create({
        ...common,
        customerItemId: 'seed-synthetic',
        rawCustomerText: pick(TEXTS[reason], cursor),
        status: 'REFUNDED',
        aiReason: reason,
        confirmedReason: reason
      });
      // Fail fast. The order above now exists without its return; the report
      // must name it so the next run's deficit maths is understood, not guessed.
      if (failedWrite(caseRes, 'insertReturnCase')) throw new Error(`insertReturnCase ${orderNumber} (order already created): ${JSON.stringify(caseRes).slice(0, 200)}`);
      madeCases += 1;
    }
  }
}

console.log(`created orders=${madeOrders} cases=${madeCases}`);
```

- [ ] **Step 5: Run it**

Run: `cd tools/access-check && node --env-file=.env seed-analytics.mjs`
Expected on a cold run: `SH-022: +80 orders, +30 returns (+23 hot)`, `DN-114: +54, +11`, `DR-051: +63, +8`, `TS-104: +119, +13`, `BG-007: +39, +3`, then `created orders=355 cases=65`. If customer A has since returned `10-4824` or `10-4825`, DN-114 or BG-007 will need one fewer return; that is expected.

If it throws, **stop and report the message verbatim**. Do not re-run blindly: a half-written pair shifts the deficits.

- [ ] **Step 6: Prove the re-run is a no-op**

Run the seeder again. Expected: every SKU prints `+0 orders, +0 returns (+0 hot)` and `created orders=0 cases=0`.

- [ ] **Step 7: Verify the seeded reality as the manager sees it**

Create `tools/access-check/verify-analytics.mjs`:

```javascript
import { signIn } from './client.mjs';

const { blocks: mgr } = await signIn(process.env.SHOPRETURN_MANAGER_EMAIL, process.env.SHOPRETURN_MANAGER_PASSWORD);

async function listAll(schema, fields) {
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await mgr.data.collection(schema, { fields }).list({ pageNo: page, pageSize: 100 });
    const items = res?.data?.[`get${schema}s`]?.items ?? [];
    rows.push(...items);
    if (items.length < 100) break;
  }
  return rows;
}

const orders = await listAll('Order', ['sku']);
const cases = await listAll('ReturnCase', ['sku', 'unitPrice', 'area', 'courier']);
const results = [];
const check = (label, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${label} -- ${detail}`); };

const bySku = (sku) => {
  const o = orders.filter((row) => row.sku === sku).length;
  const c = cases.filter((row) => row.sku === sku);
  return { orders: o, returns: c.length, rate: o ? (c.length / o) * 100 : 0, taka: c.reduce((sum, row) => sum + (row.unitPrice ?? 0), 0), rows: c };
};

for (const sku of ['SH-022', 'DN-114', 'DR-051', 'TS-104', 'BG-007']) {
  const s = bySku(sku);
  console.log(`  ${sku}: orders=${s.orders} returns=${s.returns} rate=${s.rate.toFixed(1)}% taka=${s.taka}`);
}

const sh = bySku('SH-022');
check('SH-022 has 82 orders and 31 returns', sh.orders === 82 && sh.returns === 31, `${sh.orders}/${sh.returns}`);
check('SH-022 return rate rounds to the alert\'s 38%', Math.round(sh.rate) === 38, `${sh.rate.toFixed(2)}%`);
check('SH-022 taka impact equals the alert\'s 44950', sh.taka === 44950, String(sh.taka));
const hot = sh.rows.filter((row) => row.area === 'Mirpur 11' && row.courier === 'Sundarban Courier').length;
check('24 of SH-022\'s returns are Mirpur 11 via Sundarban Courier', hot === 24, String(hot));
check('BG-007 outranks TS-104 on taka while trailing it on rate', bySku('BG-007').taka > bySku('TS-104').taka && bySku('BG-007').rate < bySku('TS-104').rate, `${bySku('BG-007').taka} vs ${bySku('TS-104').taka}`);
check('SH-022 is the costliest product (it is the headline)', ['DN-114', 'DR-051', 'TS-104', 'BG-007'].every((sku) => bySku(sku).taka < sh.taka), String(sh.taka));

const passing = results.filter(Boolean).length;
console.log(`${passing}/${results.length} passing (orders=${orders.length}, returns=${cases.length})`);
process.exit(passing === results.length ? 0 : 1);
```

Run: `cd tools/access-check && node --env-file=.env verify-analytics.mjs`
Expected: `6/6 passing`, `orders=361 returns=68` (more returns if the user has submitted demo returns since). If SH-022 is off, fix the seed. **Never** edit the fixture alert to match a wrong dataset.

- [ ] **Step 8: Prove the demo accounts are untouched**

Repeat Step 1's snapshot as customer A. Visible orders, eligible orders and return count must be identical to Step 1. If any grew, the `customerItemId` or the writer identity is wrong — stop and report.

- [ ] **Step 9: Prove the ops queue survived the seed**

Re-run `node --env-file=.env queue-scope-check.mjs` (from Task 1). Expected: `PASS`, and the open count unchanged from before seeding — the 65 new cases are all terminal.

- [ ] **Step 10: Commit** (the temp body file is outside the repo; `.env` is gitignored)

```bash
git add tools/access-check/make-seed-user.mjs tools/access-check/redact-json.mjs tools/access-check/seed-analytics.mjs tools/access-check/verify-analytics.mjs tools/access-check/.env.example
git commit -m "test(fixtures): seed a manager-scale returns dataset matching the requirement"
```

---

### Task 3: The aggregation core, pinned by tests

**Files:**
- Create: `app/src/features/insights/analytics.ts`, `app/src/features/insights/analytics.test.ts`
- Modify: `app/package.json`

**Interfaces:**
- Consumes: nothing. Pure.
- Produces:
  - `type OrderRow = { orderNumber?: string; sku?: string; productName?: string; unitPrice?: number; area?: string; courier?: string }`
  - `type CaseRow = OrderRow & { status?: string; confirmedReason?: string; aiReason?: string }`
  - `type Facet = { key: string; label: string; orders: number; returns: number; rate: number; takaImpact: number }`
  - `type Worst = { product: Facet; area: string; courier: string; pairCount: number; reason: string }`
  - `type Insights = { totals: { orders: number; returns: number; rate: number; takaImpact: number }; byProduct: Facet[]; byArea: Facet[]; byCourier: Facet[]; byReason: Facet[]; worst?: Worst }`
  - `computeInsights(orders: OrderRow[], cases: CaseRow[]): Insights`
  - `formatTaka(value: number): string` → `"৳44,950"`
  - `formatPercent(rate: number): string` → `"37.8%"` (rate is a 0–1 fraction)

- [ ] **Step 1: Add vitest**

vitest 2.x does not support Vite 8; vitest 5.0.0 declares `vite: ^6.4.0 || ^7.0.0 || ^8.0.0`.

```bash
cd app && npm install --save-dev vitest@^5.0.0
```

Add `"test": "vitest run"` to `app/package.json` scripts.

- [ ] **Step 2: Write the failing tests** — `app/src/features/insights/analytics.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeInsights, formatPercent, formatTaka } from "./analytics";

const orders = [
  { orderNumber: "1", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier" },
  { orderNumber: "2", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier" },
  { orderNumber: "3", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Gulshan 2", courier: "RedX" },
  { orderNumber: "4", sku: "BG-007", productName: "Leather Tote Bag", unitPrice: 4250, area: "Gulshan 2", courier: "RedX" }
];

const cases = [
  { orderNumber: "1", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DAMAGED_IN_TRANSIT" },
  { orderNumber: "4", sku: "BG-007", productName: "Leather Tote Bag", unitPrice: 4250, area: "Gulshan 2", courier: "RedX", confirmedReason: "CHANGED_MIND" }
];

describe("computeInsights", () => {
  it("computes return rate as returns over orders within the facet", () => {
    const sneaker = computeInsights(orders, cases).byProduct.find((f) => f.key === "SH-022");
    expect(sneaker?.orders).toBe(3);
    expect(sneaker?.returns).toBe(1);
    expect(sneaker?.rate).toBeCloseTo(1 / 3, 5);
  });

  it("computes taka impact as the summed unit price of returned items", () => {
    expect(computeInsights(orders, cases).byProduct.find((f) => f.key === "BG-007")?.takaImpact).toBe(4250);
  });

  it("ranks by taka impact, not rate", () => {
    const { byProduct } = computeInsights(orders, cases);
    expect(byProduct.map((f) => f.key)).toEqual(["BG-007", "SH-022"]);
  });

  it("prefers confirmedReason, falls back to aiReason, and never drops an uncategorised row", () => {
    const rows = [
      { orderNumber: "1", sku: "X", unitPrice: 10, aiReason: "WRONG_SIZE" },
      { orderNumber: "2", sku: "X", unitPrice: 10, aiReason: "WRONG_SIZE", confirmedReason: "DEFECTIVE" },
      { orderNumber: "3", sku: "X", unitPrice: 10 }
    ];
    expect(computeInsights([], rows).byReason.map((f) => f.key).sort()).toEqual(["DEFECTIVE", "UNCATEGORISED", "WRONG_SIZE"]);
  });

  it("gives reason facets no rate, because orders carry no reason", () => {
    expect(computeInsights(orders, cases).byReason.every((f) => f.rate === 0 && f.orders === 0)).toBe(true);
  });

  it("never divides by zero when a facet has returns but no orders", () => {
    const { byArea } = computeInsights([], [{ orderNumber: "9", area: "Ghost", unitPrice: 100 }]);
    expect(byArea[0].rate).toBe(0);
  });

  it("totals the whole dataset", () => {
    expect(computeInsights(orders, cases).totals).toEqual({ orders: 4, returns: 2, rate: 0.5, takaImpact: 5700 });
  });

  it("explains the costliest product from its own returns, not the global rankings", () => {
    const sneakerOnly = [
      { orderNumber: "1", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DAMAGED_IN_TRANSIT" },
      { orderNumber: "2", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DAMAGED_IN_TRANSIT" },
      { orderNumber: "3", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Gulshan 2", courier: "RedX", confirmedReason: "WRONG_SIZE" },
      // A different product dominating Gulshan must not leak into SH-022's sentence.
      { orderNumber: "5", sku: "TS-104", productName: "Cotton T-Shirt", unitPrice: 890, area: "Gulshan 2", courier: "RedX", confirmedReason: "WRONG_SIZE" },
      { orderNumber: "6", sku: "TS-104", productName: "Cotton T-Shirt", unitPrice: 890, area: "Gulshan 2", courier: "RedX", confirmedReason: "WRONG_SIZE" }
    ];
    const { worst } = computeInsights([], sneakerOnly);
    expect(worst).toMatchObject({ area: "Mirpur 11", courier: "Sundarban Courier", pairCount: 2, reason: "DAMAGED_IN_TRANSIT" });
    expect(worst?.product.key).toBe("SH-022");
    expect(worst?.product.returns).toBe(3);
  });

  it("has no worst product when there are no returns", () => {
    expect(computeInsights(orders, []).worst).toBeUndefined();
  });
});

describe("formatters", () => {
  it("formats taka with grouping and the taka sign", () => {
    expect(formatTaka(44950)).toBe("৳44,950");
  });

  it("formats a fraction as a one-decimal percentage", () => {
    expect(formatPercent(31 / 82)).toBe("37.8%");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd app && npm test`
Expected: FAIL — cannot resolve `./analytics`.

- [ ] **Step 4: Implement** — `app/src/features/insights/analytics.ts`:

```typescript
// Pure aggregation for the manager dashboard. No I/O, no React, no Blocks
// client: everything here is a function of its arguments, so the maths is
// tested directly (analytics.test.ts). The Blocks Data Gateway has no
// aggregate query, so this runs client-side over paged rows (useInsights.ts).

export type OrderRow = {
  orderNumber?: string;
  sku?: string;
  productName?: string;
  unitPrice?: number;
  area?: string;
  courier?: string;
};

export type CaseRow = OrderRow & {
  status?: string;
  confirmedReason?: string;
  aiReason?: string;
};

export type Facet = {
  key: string;
  label: string;
  orders: number;
  returns: number;
  rate: number;
  takaImpact: number;
};

export type Worst = {
  product: Facet;
  area: string;
  courier: string;
  pairCount: number;
  reason: string;
};

export type Insights = {
  totals: { orders: number; returns: number; rate: number; takaImpact: number };
  byProduct: Facet[];
  byArea: Facet[];
  byCourier: Facet[];
  byReason: Facet[];
  worst?: Worst;
};

// Ops confirm the reason before it counts, so confirmedReason wins; aiReason
// stands in only for cases ops has not reviewed. A row with neither is kept
// as UNCATEGORISED -- a bucket that silently loses rows would misstate every
// ranking built on it.
function reasonOf(row: CaseRow): string {
  return row.confirmedReason || row.aiReason || "UNCATEGORISED";
}

type Bucket = { label: string; orders: number; returns: number; takaImpact: number };

function facet(
  orders: OrderRow[],
  cases: CaseRow[],
  keyOf: (row: CaseRow) => string | undefined,
  labelOf: (row: CaseRow) => string | undefined
): Facet[] {
  const buckets = new Map<string, Bucket>();

  const bucket = (key: string, label: string): Bucket => {
    const found = buckets.get(key);
    if (found) return found;
    const created = { label, orders: 0, returns: 0, takaImpact: 0 };
    buckets.set(key, created);
    return created;
  };

  for (const order of orders) {
    const key = keyOf(order);
    if (key) bucket(key, labelOf(order) || key).orders += 1;
  }

  for (const row of cases) {
    const key = keyOf(row);
    if (!key) continue;
    const entry = bucket(key, labelOf(row) || key);
    entry.returns += 1;
    entry.takaImpact += row.unitPrice ?? 0;
  }

  return [...buckets.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      orders: entry.orders,
      returns: entry.returns,
      // A returned row whose order is missing from Order would otherwise give
      // Infinity and a bar of impossible width.
      rate: entry.orders > 0 ? entry.returns / entry.orders : 0,
      takaImpact: entry.takaImpact
    }))
    .sort((a, b) => b.takaImpact - a.takaImpact || b.returns - a.returns);
}

// The headline has to say *where* and *why* the costliest product is costing
// money. That must come from that product's own returns: taking the top area
// from the global ranking would pin another product's problem on it.
function worstOf(byProduct: Facet[], cases: CaseRow[]): Worst | undefined {
  const product = byProduct[0];
  if (!product || product.returns === 0) return undefined;

  const pairs = new Map<string, { area: string; courier: string; count: number }>();
  const reasons = new Map<string, number>();

  for (const row of cases) {
    if (row.sku !== product.key) continue;
    const reason = reasonOf(row);
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    if (!row.area || !row.courier) continue;
    const key = `${row.area}|${row.courier}`;
    const pair = pairs.get(key) ?? { area: row.area, courier: row.courier, count: 0 };
    pair.count += 1;
    pairs.set(key, pair);
  }

  const topPair = [...pairs.values()].sort((a, b) => b.count - a.count)[0];
  const topReason = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    product,
    area: topPair?.area ?? "",
    courier: topPair?.courier ?? "",
    pairCount: topPair?.count ?? 0,
    reason: topReason?.[0] ?? "UNCATEGORISED"
  };
}

export function computeInsights(orders: OrderRow[], cases: CaseRow[]): Insights {
  const byProduct = facet(orders, cases, (row) => row.sku, (row) => row.productName);

  return {
    totals: {
      orders: orders.length,
      returns: cases.length,
      rate: orders.length > 0 ? cases.length / orders.length : 0,
      takaImpact: cases.reduce((sum, row) => sum + (row.unitPrice ?? 0), 0)
    },
    byProduct,
    byArea: facet(orders, cases, (row) => row.area, (row) => row.area),
    byCourier: facet(orders, cases, (row) => row.courier, (row) => row.courier),
    // Orders carry no reason, so there is no denominator: passing [] keeps
    // rate at 0. A "return rate by reason" here would be a lie with a percent
    // sign, so the reason facet is ranked by money and volume only.
    byReason: facet([], cases, reasonOf, reasonOf),
    worst: worstOf(byProduct, cases)
  };
}

export function formatTaka(value: number): string {
  return `৳${Math.round(value).toLocaleString("en-US")}`;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd app && npm test`
Expected: 11 tests PASS.

- [ ] **Step 6: Lint, build, commit**

```bash
cd app && npm run lint && npm run build && npm test
cd .. && git add app/src/features/insights/analytics.ts app/src/features/insights/analytics.test.ts app/package.json app/package-lock.json
git commit -m "feat(insights): pure, unit-tested returns aggregation"
```

---

### Task 4: Data hook, route, nav, and every insights string

**Files:**
- Create: `app/src/features/insights/useInsights.ts`, `app/scripts/i18n-parity.mjs`
- Modify: `app/src/app/router/routes.tsx`, `app/src/app/layout/navItems.ts`, the three i18n files

**Interfaces:**
- Consumes: `computeInsights`, `CaseRow`, `Insights`, `OrderRow` from `./analytics`; `blocksClient`.
- Produces: `useInsights(): { insights?: Insights; loading: boolean; error?: string; refetch: () => Promise<void> }`

- [ ] **Step 1: Write `useInsights.ts`**

```typescript
import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { computeInsights } from "./analytics";
import type { CaseRow, Insights, OrderRow } from "./analytics";

const ORDER_FIELDS = ["orderNumber", "sku", "productName", "unitPrice", "area", "courier"];
const CASE_FIELDS = [...ORDER_FIELDS, "status", "confirmedReason", "aiReason"];

// No aggregate query exists in the Data Gateway, so the dataset is paged in
// and reduced in the browser. The 50-page cap is a runaway guard, not a data
// limit (5,000 rows each at pageSize 100).
async function listAll<T>(schema: string, fields: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const response = await blocksClient.data
      .collection(schema, { fields })
      .list({ pageNo: page, pageSize: 100 }) as { data?: Record<string, { items?: T[] } | undefined> };
    const items = response?.data?.[`get${schema}s`]?.items ?? [];
    rows.push(...items);
    if (items.length < 100) break;
  }
  return rows;
}

export function useInsights() {
  const [insights, setInsights] = useState<Insights>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      // No ownership filter: the manager legitimately sees every order and
      // case, and the read policies already decided that server-side.
      const [orders, cases] = await Promise.all([
        listAll<OrderRow>("Order", ORDER_FIELDS),
        listAll<CaseRow>("ReturnCase", CASE_FIELDS)
      ]);
      setInsights(computeInsights(orders, cases));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { insights, loading, error, refetch: load };
}
```

- [ ] **Step 2: Route and nav**

In `routes.tsx`: `import { InsightsPage } from "../../features/insights/InsightsPage";` and add `"/insights": InsightsPage` to `protectedRoutes`. `InsightsPage` is created in Task 5; to keep this task's build green, create a placeholder now that Task 5 replaces wholesale:

```tsx
// Replaced in Task 5.
export function InsightsPage() {
  return <section />;
}
```

In `navItems.ts`, add `TrendingUp` to the `lucide-react` import and append:

```typescript
  { href: "/insights", labelKey: "nav.insights", icon: TrendingUp, requiresRole: "manager" }
```

Extend the file's leading comment with one line: the manager gets `/insights` and not `/ops`, because the manager decides causes and ops decides cases.

- [ ] **Step 3: Add every insights key to all three files**

Tasks 5 and 6 use all of these. Adding them in one pass means the three files are edited once and pushed once.

| Key | en | bn |
|---|---|---|
| `nav.insights` | Insights | ইনসাইটস |
| `insights.title` | Returns insights | রিটার্ন ইনসাইটস |
| `insights.subtitle` | What returns are costing, and what we decided to do about it. | রিটার্নে কত খরচ হচ্ছে, আর আমরা কী সিদ্ধান্ত নিয়েছি। |
| `insights.loadError` | Could not load returns insights. | রিটার্ন ইনসাইটস লোড করা যায়নি। |
| `insights.headline.none` | No returns recorded yet. | এখনও কোনো রিটার্ন নেই। |
| `insights.headline.lead` | Returns are running at {rate} of orders, costing {taka}. | অর্ডারের {rate} রিটার্ন হচ্ছে, খরচ {taka}। |
| `insights.headline.worst` | {product} costs the most at {taka}: {pairCount} of its {returns} returns came from {area} via {courier}, most often {reason}. | {product} সবচেয়ে বেশি খরচ করাচ্ছে, {taka}: এর {returns}টি রিটার্নের {pairCount}টি এসেছে {area} থেকে, {courier} এর মাধ্যমে; বেশিরভাগ কারণ {reason}। |
| `insights.headline.worstNoPlace` | {product} costs the most at {taka}, most often {reason}. | {product} সবচেয়ে বেশি খরচ করাচ্ছে, {taka}; বেশিরভাগ কারণ {reason}। |
| `insights.facet.product` | By product | পণ্য অনুযায়ী |
| `insights.facet.area` | By area | এলাকা অনুযায়ী |
| `insights.facet.courier` | By courier | কুরিয়ার অনুযায়ী |
| `insights.facet.reason` | By reason | কারণ অনুযায়ী |
| `insights.facet.rate` | return rate | রিটার্ন হার |
| `insights.facet.returns` | returns | রিটার্ন |
| `insights.facet.orders` | orders | অর্ডার |
| `insights.facet.breach` | ▲ over 30% threshold | ▲ ৩০% সীমা ছাড়িয়েছে |
| `insights.reason.uncategorised` | not yet categorised | এখনও শ্রেণিবদ্ধ হয়নি |
| `insights.restricted.title` | Insights are for the business manager | ইনসাইটস ব্যবসা ম্যানেজারের জন্য |
| `insights.restricted.description` | You're signed in as {role}. This dashboard is limited to the manager role. | আপনি {role} হিসেবে সাইন ইন করেছেন। এই ড্যাশবোর্ড শুধু ম্যানেজার রোলের জন্য। |
| `insights.restricted.genericRole` | another role | অন্য একটি রোল |
| `insights.alerts.title` | Pattern alerts | প্যাটার্ন সতর্কতা |
| `insights.alerts.empty` | No pattern alerts raised. | কোনো প্যাটার্ন সতর্কতা নেই। |
| `insights.alerts.loadError` | Could not load pattern alerts. | প্যাটার্ন সতর্কতা লোড করা যায়নি। |
| `insights.alerts.sentence` | {value} return rate is {metric}%, over the {threshold}% threshold, costing {taka}. | {value} এর রিটার্ন হার {metric}%, {threshold}% সীমার উপরে; খরচ {taka}। |
| `insights.alerts.draftLabel` | Agent's draft explanation, not yet confirmed | এজেন্টের খসড়া ব্যাখ্যা, এখনও নিশ্চিত নয় |
| `insights.alerts.raisedAt` | Raised {when} | উত্থাপিত {when} |
| `insights.alerts.acknowledge` | Acknowledge | স্বীকার করুন |
| `insights.alerts.acknowledgedBy` | Acknowledged by {who} | {who} স্বীকার করেছেন |
| `insights.alerts.acknowledgeError` | Could not acknowledge this alert. Try again. | সতর্কতাটি স্বীকার করা যায়নি। আবার চেষ্টা করুন। |
| `insights.decisions.title` | Decisions | সিদ্ধান্ত |
| `insights.decisions.empty` | No decisions recorded yet. | এখনও কোনো সিদ্ধান্ত নেই। |
| `insights.decisions.loadError` | Could not load decisions. | সিদ্ধান্ত লোড করা যায়নি। |
| `insights.decisions.alert` | Alert | সতর্কতা |
| `insights.decisions.type` | Decision | সিদ্ধান্ত |
| `insights.decisions.target` | Applies to | প্রযোজ্য |
| `insights.decisions.note` | What we decided | আমরা কী সিদ্ধান্ত নিলাম |
| `insights.decisions.notePlaceholder` | e.g. Pause COD in Mirpur 11 until the courier issue is resolved. | যেমন: কুরিয়ার সমস্যা না মেটা পর্যন্ত মিরপুর ১১-এ COD বন্ধ রাখা। |
| `insights.decisions.record` | Record decision | সিদ্ধান্ত নথিভুক্ত করুন |
| `insights.decisions.saveError` | Could not record the decision. Reload before trying again. | সিদ্ধান্ত নথিভুক্ত করা যায়নি। আবার চেষ্টার আগে পেজ রিলোড করুন। |
| `insights.decisions.markDone` | Mark done | সম্পন্ন চিহ্নিত করুন |
| `insights.decisions.completeError` | Could not update this decision. | সিদ্ধান্তটি হালনাগাদ করা যায়নি। |
| `insights.decisions.status.OPEN` | open | চলমান |
| `insights.decisions.status.DONE` | done | সম্পন্ন |
| `insights.decisions.type.SIZE_CHART_FIX` | size chart fix | সাইজ চার্ট সংশোধন |
| `insights.decisions.type.COURIER_CLAIM` | courier claim | কুরিয়ার দাবি |
| `insights.decisions.type.COD_PAUSE` | COD pause | COD স্থগিত |
| `insights.decisions.type.OTHER` | other | অন্যান্য |

`saveError` says *reload before trying again* rather than *nothing was saved*, because a thrown network error after the insert landed cannot be told apart from one before it, and a blind retry would duplicate the decision.

- [ ] **Step 4: Check parity** — create `app/scripts/i18n-parity.mjs`:

```javascript
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const en = new Set(Object.keys(JSON.parse(read("blocks/localization/common.en.json"))));
const bn = new Set(Object.keys(JSON.parse(read("blocks/localization/common.bn.json"))));
const dict = new Set([...read("src/lib/i18n/dictionary.ts").matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));

const missing = (from, into) => [...from].filter((key) => !into.has(key));
const problems = [
  ["dictionary.ts -> en", missing(dict, en)], ["dictionary.ts -> bn", missing(dict, bn)],
  ["en -> dictionary.ts", missing(en, dict)], ["bn -> dictionary.ts", missing(bn, dict)]
].filter(([, keys]) => keys.length > 0);

console.log(`dictionary=${dict.size} en=${en.size} bn=${bn.size}`);
for (const [label, keys] of problems) console.log(`MISSING ${label}: ${keys.join(", ")}`);
process.exit(problems.length === 0 ? 0 : 1);
```

Run: `cd app && node scripts/i18n-parity.mjs`
Expected: three equal counts and no `MISSING` lines. If the JSON files turn out to be nested rather than flat, stop and report — the script's assumption is wrong, not the files.

- [ ] **Step 5: Push localization — dry-run, show, approve**

```bash
cd app
blocks localization validate --json
blocks localization push --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json
```

Show the user, get approval, re-run with `--yes`.

- [ ] **Step 6: Verify the push through the read path the app uses**

The push's success message is not evidence: short culture codes once "succeeded" and served `[ KEY MISSING ]`. Reproduce, with a signed-in token, the exact language-file request `app/src/lib/i18n/LocalizationProvider.tsx` makes, for `en-US` and `bn-BD`. Confirm `insights.headline.worst`, `insights.decisions.type.COD_PAUSE` and `ops.scope.open` come back with the table's text. Report counts, not the full payload.

- [ ] **Step 7: Lint, build, commit**

```bash
cd app && npm run lint && npm run build && npm test
cd .. && git add app/src/features/insights/useInsights.ts app/src/features/insights/InsightsPage.tsx app/scripts/i18n-parity.mjs app/src/app/router/routes.tsx app/src/app/layout/navItems.ts app/src/lib/i18n/dictionary.ts app/blocks/localization
git commit -m "feat(insights): data hook, manager-gated route and localisation"
```

---

### Task 5: Answer-first page and ranked bars

The spec opens this screen with **the question answered in prose**; the bars are evidence beneath it. A KPI grid was considered and rejected. Build the sentence first.

**Files:**
- Create: `app/src/features/insights/FacetBars.tsx`
- Replace: `app/src/features/insights/InsightsPage.tsx` (the Task 4 placeholder)
- Modify: `app/src/app/ledger.css`

**Interfaces:**
- Consumes: `useInsights`, `Facet`, `Insights`, `formatPercent`, `formatTaka`, `useRoles`, `useT`, `TranslationKey`, `PageHeader`, `Skeleton`, `ErrorState`, `EmptyState`, `ActionButton`.
- Produces: `InsightsPage()`; `FacetBars({ title, facets, showRate, labelFor? })`; `useReasonLabel(): (reason: string) => string` (exported from `InsightsPage.tsx`).

- [ ] **Step 1: Write `FacetBars.tsx`**

Palette from the spec, already validated for colour-vision deficiency: bars `#2563A8`, breach `#B23A18` (`--ledger-warn`). Values are **direct-labelled** — no axis, legend or tooltip-only data. A breach carries colour **and** words.

```tsx
import { formatPercent, formatTaka } from "./analytics";
import type { Facet } from "./analytics";
import { useT } from "../../lib/i18n/LocalizationProvider";

// The threshold the fixture PatternAlert uses (threshold: 30).
const BREACH_RATE = 0.3;

export function FacetBars({
  title,
  facets,
  showRate,
  labelFor
}: {
  title: string;
  facets: Facet[];
  showRate: boolean;
  labelFor?: (facet: Facet) => string;
}) {
  const { t } = useT();
  const shown = facets.slice(0, 6);
  const max = Math.max(1, ...shown.map((facet) => facet.takaImpact));

  return (
    <section className="facet">
      <h3 className="facet-title">{title}</h3>
      <ol className="facet-list">
        {shown.map((facet) => {
          const breach = showRate && facet.rate >= BREACH_RATE;
          return (
            <li key={facet.key} className="facet-row">
              <div className="facet-row-head">
                <span className="facet-label">{labelFor ? labelFor(facet) : facet.label}</span>
                <span className="facet-value">{formatTaka(facet.takaImpact)}</span>
              </div>
              <div className="facet-track" aria-hidden="true">
                <div
                  className={breach ? "facet-bar facet-bar-breach" : "facet-bar"}
                  style={{ width: `${Math.max(2, (facet.takaImpact / max) * 100)}%` }}
                />
              </div>
              <div className="facet-row-foot">
                <span>
                  {facet.returns} {t("insights.facet.returns")}
                  {showRate ? ` / ${facet.orders} ${t("insights.facet.orders")}` : ""}
                </span>
                {showRate ? (
                  <span className={breach ? "facet-rate facet-rate-breach" : "facet-rate"}>
                    {formatPercent(facet.rate)} {t("insights.facet.rate")}
                    {/* Stated in words as well as colour: a breach must not
                        depend on telling two hues apart. */}
                    {breach ? ` ${t("insights.facet.breach")}` : ""}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
```

- [ ] **Step 2: Write `InsightsPage.tsx`**

```tsx
import { RefreshCw } from "lucide-react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ErrorState } from "../../shared/ui/ErrorState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useRoles } from "../../lib/blocks/useRoles";
import { formatPercent, formatTaka } from "./analytics";
import type { Insights } from "./analytics";
import { FacetBars } from "./FacetBars";
import { useInsights } from "./useInsights";

// Reason labels already exist for the ops review screen; reuse them so a
// reason reads identically wherever it appears.
export function useReasonLabel() {
  const { t } = useT();
  return (reason: string) =>
    reason === "UNCATEGORISED"
      ? t("insights.reason.uncategorised")
      : t(`ops.review.reason.${reason}` as TranslationKey, reason);
}

function Answer({ insights }: { insights: Insights }) {
  const { t } = useT();
  const reasonLabel = useReasonLabel();

  if (insights.totals.returns === 0) {
    return <p className="insights-answer insights-answer-lead">{t("insights.headline.none")}</p>;
  }

  const lead = t("insights.headline.lead")
    .replace("{rate}", formatPercent(insights.totals.rate))
    .replace("{taka}", formatTaka(insights.totals.takaImpact));

  const worst = insights.worst;
  let worstSentence = "";
  if (worst) {
    const template = worst.pairCount > 0 ? t("insights.headline.worst") : t("insights.headline.worstNoPlace");
    worstSentence = template
      .replace("{product}", `${worst.product.label} (${worst.product.key})`)
      .replace("{taka}", formatTaka(worst.product.takaImpact))
      .replace("{pairCount}", String(worst.pairCount))
      .replace("{returns}", String(worst.product.returns))
      .replace("{area}", worst.area)
      .replace("{courier}", worst.courier)
      .replace("{reason}", reasonLabel(worst.reason));
  }

  return (
    <div className="insights-answer">
      <p className="insights-answer-lead">{lead}</p>
      {worstSentence ? <p className="insights-answer-worst">{worstSentence}</p> : null}
    </div>
  );
}

// Hooks live here, below the role gate, so a non-manager who types the URL
// never triggers the manager's data fetch at all.
function Dashboard() {
  const { t } = useT();
  const reasonLabel = useReasonLabel();
  const { insights, loading, error, refetch } = useInsights();

  return (
    <section className="insights-page">
      <PageHeader
        title={t("insights.title")}
        subtitle={t("insights.subtitle")}
        actions={<ActionButton variant="icon" onClick={() => refetch()} title={t("common.refresh")} icon={<RefreshCw size={18} />} />}
      />

      {loading ? (
        <div className="panel">
          <Skeleton className="skeleton-line" style={{ width: "100%" }} />
          <Skeleton className="skeleton-line" style={{ width: "80%" }} />
          <Skeleton className="skeleton-line" style={{ width: "90%" }} />
        </div>
      ) : error ? (
        <ErrorState message={t("insights.loadError")} onRetry={() => refetch()} />
      ) : insights ? (
        <>
          <Answer insights={insights} />
          <div className="insights-facets">
            <FacetBars title={t("insights.facet.product")} facets={insights.byProduct} showRate />
            <FacetBars title={t("insights.facet.area")} facets={insights.byArea} showRate />
            <FacetBars title={t("insights.facet.courier")} facets={insights.byCourier} showRate />
            <FacetBars
              title={t("insights.facet.reason")}
              facets={insights.byReason}
              showRate={false}
              labelFor={(facet) => reasonLabel(facet.key)}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}

export function InsightsPage() {
  const { t } = useT();
  const { hasRole, isLoading: rolesLoading, roles } = useRoles();

  // Roles load from iam.me(); denying before they arrive would flash the
  // restricted notice at the manager. UX only -- rules.json is the boundary.
  if (rolesLoading) {
    return (
      <section>
        <div className="panel">
          <Skeleton className="skeleton-line" style={{ width: "100%" }} />
          <Skeleton className="skeleton-line" style={{ width: "90%" }} />
        </div>
      </section>
    );
  }

  if (!hasRole("manager")) {
    const roleLabel = roles.length > 0 ? roles.join(", ") : t("insights.restricted.genericRole");
    return (
      <section>
        <EmptyState
          title={t("insights.restricted.title")}
          description={t("insights.restricted.description").replace("{role}", roleLabel)}
        />
      </section>
    );
  }

  return <Dashboard />;
}
```

- [ ] **Step 3: Styles** — append to `app/src/app/ledger.css`:

```css
/* ---- Manager insights ------------------------------------------------ */
.insights-page { --insights-bar: #2563A8; --insights-breach: var(--ledger-warn); color: var(--ledger-ink); }
.insights-answer { border-left: 2px solid var(--ledger-ink); margin: 8px 0 36px; padding: 4px 0 4px 18px; }
.insights-answer-lead { color: var(--ledger-muted); font-family: var(--ledger-serif); font-size: 15px; margin: 0 0 8px; }
.insights-answer-worst { font-family: var(--ledger-serif); font-size: clamp(18px, 2.2vw, 22px); line-height: 1.45; margin: 0; max-width: 62ch; }
.insights-facets { display: grid; gap: 32px 44px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); }
.facet-title {
  border-bottom: 1px solid var(--ledger-rule); color: var(--ledger-muted); font-family: var(--ledger-mono);
  font-size: 11px; font-weight: 600; letter-spacing: 0.08em; margin: 0 0 12px; padding-bottom: 8px; text-transform: uppercase;
}
.facet-list { display: grid; gap: 14px; list-style: none; margin: 0; padding: 0; }
.facet-row-head, .facet-row-foot { align-items: baseline; display: flex; gap: 12px; justify-content: space-between; }
.facet-label { font-family: var(--ledger-serif); font-size: 14.5px; overflow-wrap: anywhere; }
.facet-value { font-family: var(--ledger-mono); font-size: 13px; font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
.facet-track { background: var(--ledger-band); border-radius: 2px; height: 6px; margin: 6px 0 4px; overflow: hidden; }
.facet-bar { background: var(--insights-bar); border-radius: 2px; height: 100%; }
.facet-bar-breach { background: var(--insights-breach); }
.facet-row-foot { color: var(--ledger-faint); flex-wrap: wrap; font-family: var(--ledger-mono); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.facet-rate-breach { color: var(--insights-breach); font-weight: 600; }
```

- [ ] **Step 4: Verify as manager in the browser**

Sign in as `shopreturn-manager@yopmail.com` at `https://dbzjdy.slsblx.com:5173/insights`. Confirm and screenshot:

- The lead reads *"Returns are running at 18.8% of orders, costing ৳121,300."* (higher if demo returns were added).
- The headline reads *"Canvas Sneaker (SH-022) costs the most at ৳44,950: 24 of its 31 returns came from Mirpur 11 via Sundarban Courier, most often damaged in transit."*
- SH-022's bar shows `37.8%`, the breach colour **and** the "▲ over 30% threshold" text.
- `BG-007` sits above `TS-104` in *By product* despite the lower rate.
- *By reason* shows no percentages.
- Switch to Bangla: no `[ KEY MISSING ]` anywhere.
- At ~400px width the facets stack to one column and nothing scrolls horizontally.

- [ ] **Step 5: Verify the role wall in the browser**

As ops and as customer A: no *Insights* nav item; visiting `/insights` directly shows the restricted notice. (Task 7 asserts the server side.)

- [ ] **Step 6: Lint, build, test, commit**

```bash
cd app && npm run lint && npm run build && npm test
cd .. && git add app/src/features/insights/InsightsPage.tsx app/src/features/insights/FacetBars.tsx app/src/app/ledger.css
git commit -m "feat(insights): answer-first headline and ranked taka-impact facets"
```

---

### Task 6: Alert strip and decision log

This closes the loop the requirement describes: the alert is waiting before the manager arrives, and the manager's output is recorded decisions — size chart, courier claim, COD pause.

**Files:**
- Create: `app/src/features/insights/useAlerts.ts`, `useDecisions.ts`, `AlertStrip.tsx`, `DecisionLog.tsx`
- Modify: `app/src/features/insights/InsightsPage.tsx` (the `Dashboard` component only), `app/src/app/ledger.css`

**Interfaces:**
- Consumes: `blocksClient`; `useMe` from `../../lib/blocks/useMe`; `mutationFailed`, `GraphQLError`, `MutationPayload` from `../ops/opsTimeline`; `formatTaka`.
- Produces:
  - `type AlertRow = { ItemId: string; dimension?: string; value?: string; metric?: number; threshold?: number; takaImpact?: number; draftExplanation?: string; raisedAt?: string; acknowledgedBy?: string }`
  - `useAlerts(): { alerts: AlertRow[]; loading: boolean; error?: string; acknowledge: (itemId: string) => Promise<boolean>; refetch: () => Promise<void> }`
  - `type DecisionType = "SIZE_CHART_FIX" | "COURIER_CLAIM" | "COD_PAUSE" | "OTHER"`
  - `type DecisionRow = { ItemId: string; alertId?: string; decisionType?: string; target?: string; note?: string; decidedBy?: string; decidedAt?: string; status?: string }`
  - `useDecisions(): { decisions: DecisionRow[]; loading: boolean; error?: string; record: (input: { alertId: string; decisionType: DecisionType; target: string; note: string }) => Promise<boolean>; complete: (itemId: string) => Promise<boolean>; refetch: () => Promise<void> }`

- [ ] **Step 1: Write `useAlerts.ts`**

`contributingReturnIds` is deliberately not requested: the fixture alert links one return while its explanation cites 31, and the schema declares a `String` that reads back as an array. Showing a count would print a contradiction.

```typescript
import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { useMe } from "../../lib/blocks/useMe";
import { mutationFailed } from "../ops/opsTimeline";
import type { GraphQLError, MutationPayload } from "../ops/opsTimeline";

export type AlertRow = {
  ItemId: string;
  dimension?: string;
  value?: string;
  metric?: number;
  threshold?: number;
  takaImpact?: number;
  draftExplanation?: string;
  raisedAt?: string;
  acknowledgedBy?: string;
};

// Confirmed live field names; any other name returns 400.
const FIELDS = ["dimension", "value", "metric", "threshold", "takaImpact", "draftExplanation", "raisedAt", "acknowledgedBy"];

type ListResponse = { data?: { getPatternAlerts?: { items?: AlertRow[] } } };
type UpdateResponse = { data?: { updatePatternAlert?: MutationPayload }; errors?: GraphQLError[] };

export function useAlerts() {
  const me = useMe();
  const managerEmail = me.data?.data?.email ?? "";
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await blocksClient.data
        .collection("PatternAlert", { fields: FIELDS })
        .list({ pageNo: 1, pageSize: 20, sort: { CreatedDate: -1 } }) as ListResponse;
      setAlerts(response?.data?.getPatternAlerts?.items ?? []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // "Acknowledged" is recorded as who acknowledged it. An empty string means
  // nobody has -- the fixture is reset to "", not null.
  const acknowledge = useCallback(async (itemId: string): Promise<boolean> => {
    if (!managerEmail) return false;
    try {
      const response = await blocksClient.data
        .collection("PatternAlert")
        .update(itemId, { acknowledgedBy: managerEmail }) as UpdateResponse;
      if (mutationFailed(response, response?.data?.updatePatternAlert)) return false;
      await load();
      return true;
    } catch {
      return false;
    }
  }, [load, managerEmail]);

  return { alerts, loading, error, acknowledge, refetch: load };
}
```

- [ ] **Step 2: Write `useDecisions.ts`**

```typescript
import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { useMe } from "../../lib/blocks/useMe";
import { mutationFailed } from "../ops/opsTimeline";
import type { GraphQLError, MutationPayload } from "../ops/opsTimeline";

export type DecisionType = "SIZE_CHART_FIX" | "COURIER_CLAIM" | "COD_PAUSE" | "OTHER";

export type DecisionRow = {
  ItemId: string;
  alertId?: string;
  decisionType?: string;
  target?: string;
  note?: string;
  decidedBy?: string;
  decidedAt?: string;
  status?: string;
};

const FIELDS = ["alertId", "decisionType", "target", "note", "decidedBy", "decidedAt", "status"];

type ListResponse = { data?: { getDecisions?: { items?: DecisionRow[] } } };
type InsertResponse = { data?: { insertDecision?: MutationPayload }; errors?: GraphQLError[] };
type UpdateResponse = { data?: { updateDecision?: MutationPayload }; errors?: GraphQLError[] };

// The log is append-and-amend: the manager has no delete grant on Decision
// (401, confirmed live), so no delete control is ever offered. A decision
// that turns out wrong is marked done and superseded by a new one.
export function useDecisions() {
  const me = useMe();
  const managerEmail = me.data?.data?.email ?? "";
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await blocksClient.data
        .collection("Decision", { fields: FIELDS })
        .list({ pageNo: 1, pageSize: 50, sort: { CreatedDate: -1 } }) as ListResponse;
      setDecisions(response?.data?.getDecisions?.items ?? []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const record = useCallback(async (input: { alertId: string; decisionType: DecisionType; target: string; note: string }): Promise<boolean> => {
    try {
      const response = await blocksClient.data.collection("Decision").create({
        ...input,
        decidedBy: managerEmail,
        decidedAt: new Date().toISOString(),
        status: "OPEN"
      }) as InsertResponse;
      if (mutationFailed(response, response?.data?.insertDecision)) return false;
      await load();
      return true;
    } catch {
      return false;
    }
  }, [load, managerEmail]);

  const complete = useCallback(async (itemId: string): Promise<boolean> => {
    try {
      const response = await blocksClient.data.collection("Decision").update(itemId, { status: "DONE" }) as UpdateResponse;
      if (mutationFailed(response, response?.data?.updateDecision)) return false;
      await load();
      return true;
    } catch {
      return false;
    }
  }, [load]);

  return { decisions, loading, error, record, complete, refetch: load };
}
```

- [ ] **Step 3: Write `AlertStrip.tsx`**

Each alert reads as a sentence. The agent's explanation is **labelled as a draft**, so it is never mistaken for a confirmed finding. `raisedAt` is shown because the requirement's claim is that the alert *predates* the manager's visit — the timestamp is the evidence.

```tsx
import { useState } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ErrorState } from "../../shared/ui/ErrorState";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { formatTaka } from "./analytics";
import type { AlertRow } from "./useAlerts";

export function AlertStrip({
  alerts,
  loading,
  error,
  onAcknowledge,
  onRetry
}: {
  alerts: AlertRow[];
  loading: boolean;
  error?: string;
  onAcknowledge: (itemId: string) => Promise<boolean>;
  onRetry: () => void;
}) {
  const { t } = useT();
  const [busyId, setBusyId] = useState<string>();
  const [failedId, setFailedId] = useState<string>();

  if (loading) {
    return <div className="alert-strip"><Skeleton className="skeleton-line" style={{ width: "100%" }} /></div>;
  }
  if (error) {
    return <div className="alert-strip"><ErrorState message={t("insights.alerts.loadError")} onRetry={onRetry} /></div>;
  }
  if (alerts.length === 0) {
    return <p className="alert-strip-empty">{t("insights.alerts.empty")}</p>;
  }

  async function acknowledge(itemId: string) {
    setBusyId(itemId);
    setFailedId(undefined);
    const ok = await onAcknowledge(itemId);
    if (!ok) setFailedId(itemId);
    setBusyId(undefined);
  }

  return (
    <section className="alert-strip" aria-label={t("insights.alerts.title")}>
      {alerts.map((alert) => {
        const acknowledged = Boolean(alert.acknowledgedBy);
        return (
          <article key={alert.ItemId} className={acknowledged ? "alert-card alert-card-quiet" : "alert-card"}>
            <p className="alert-sentence">
              {t("insights.alerts.sentence")
                .replace("{value}", alert.value ?? "")
                .replace("{metric}", String(alert.metric ?? 0))
                .replace("{threshold}", String(alert.threshold ?? 0))
                .replace("{taka}", formatTaka(alert.takaImpact ?? 0))}
            </p>
            {alert.draftExplanation ? (
              <div>
                <span className="alert-draft-label">{t("insights.alerts.draftLabel")}</span>
                <p className="alert-draft">{alert.draftExplanation}</p>
              </div>
            ) : null}
            <div className="alert-actions">
              <span className="alert-meta">
                {alert.raisedAt ? t("insights.alerts.raisedAt").replace("{when}", new Date(alert.raisedAt).toLocaleString()) : ""}
              </span>
              {acknowledged ? (
                <span className="alert-meta">{t("insights.alerts.acknowledgedBy").replace("{who}", alert.acknowledgedBy ?? "")}</span>
              ) : (
                <ActionButton onClick={() => void acknowledge(alert.ItemId)} disabled={busyId === alert.ItemId}>
                  {t("insights.alerts.acknowledge")}
                </ActionButton>
              )}
            </div>
            {failedId === alert.ItemId ? (
              <p className="ledger-rejection" role="alert">{t("insights.alerts.acknowledgeError")}</p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 4: Write `DecisionLog.tsx`**

The form offers exactly the requirement's three decisions plus *other*, with the target prefilled from the selected alert.

```tsx
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ErrorState } from "../../shared/ui/ErrorState";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import type { AlertRow } from "./useAlerts";
import { useDecisions } from "./useDecisions";
import type { DecisionType } from "./useDecisions";

const TYPES: DecisionType[] = ["SIZE_CHART_FIX", "COURIER_CLAIM", "COD_PAUSE", "OTHER"];

export function DecisionLog({ alerts }: { alerts: AlertRow[] }) {
  const { t } = useT();
  const { decisions, loading, error, record, complete, refetch } = useDecisions();
  const [alertId, setAlertId] = useState("");
  const [decisionType, setDecisionType] = useState<DecisionType>("SIZE_CHART_FIX");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [completeFailedId, setCompleteFailedId] = useState<string>();

  // Default to the newest alert once alerts arrive, and prefill the target
  // with what that alert is about -- a decision is usually about the thing
  // the alert names.
  useEffect(() => {
    if (!alertId && alerts[0]) {
      setAlertId(alerts[0].ItemId);
      setTarget(alerts[0].value ?? "");
    }
  }, [alerts, alertId]);

  function chooseAlert(nextId: string) {
    setAlertId(nextId);
    setTarget(alerts.find((alert) => alert.ItemId === nextId)?.value ?? "");
  }

  const canSubmit = Boolean(alertId && target.trim() && note.trim()) && !saving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setSaveFailed(false);
    const ok = await record({ alertId, decisionType, target: target.trim(), note: note.trim() });
    setSaving(false);
    if (ok) setNote("");
    else setSaveFailed(true);
  }

  async function markDone(itemId: string) {
    setCompleteFailedId(undefined);
    const ok = await complete(itemId);
    if (!ok) setCompleteFailedId(itemId);
  }

  const typeLabel = (type?: string) => t(`insights.decisions.type.${type ?? "OTHER"}` as TranslationKey, type);
  const statusLabel = (status?: string) => t(`insights.decisions.status.${status ?? "OPEN"}` as TranslationKey, status);

  return (
    <section className="decision-log">
      <h2 className="decision-log-title">{t("insights.decisions.title")}</h2>

      <form className="decision-form" onSubmit={(event) => void submit(event)}>
        <label>
          {t("insights.decisions.alert")}
          <select value={alertId} onChange={(event) => chooseAlert(event.target.value)} disabled={alerts.length === 0}>
            {alerts.map((alert) => (
              <option key={alert.ItemId} value={alert.ItemId}>{`${alert.dimension ?? ""} ${alert.value ?? ""}`.trim()}</option>
            ))}
          </select>
        </label>
        <label>
          {t("insights.decisions.type")}
          <select value={decisionType} onChange={(event) => setDecisionType(event.target.value as DecisionType)}>
            {TYPES.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
          </select>
        </label>
        <label>
          {t("insights.decisions.target")}
          <input value={target} onChange={(event) => setTarget(event.target.value)} />
        </label>
        <label className="decision-form-wide">
          {t("insights.decisions.note")}
          <textarea rows={3} value={note} placeholder={t("insights.decisions.notePlaceholder")} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="decision-form-wide">
          <ActionButton type="submit" disabled={!canSubmit}>{t("insights.decisions.record")}</ActionButton>
          {saveFailed ? <p className="ledger-rejection" role="alert">{t("insights.decisions.saveError")}</p> : null}
        </div>
      </form>

      {loading ? (
        <Skeleton className="skeleton-line" style={{ width: "100%" }} />
      ) : error ? (
        <ErrorState message={t("insights.decisions.loadError")} onRetry={() => refetch()} />
      ) : decisions.length === 0 ? (
        <p className="alert-strip-empty">{t("insights.decisions.empty")}</p>
      ) : (
        <div className="decision-rows">
          {decisions.map((decision) => (
            <div key={decision.ItemId} className="decision-row">
              <span className="decision-type">{typeLabel(decision.decisionType)} · {decision.target}</span>
              <span className={`decision-type decision-status-${decision.status ?? "OPEN"}`}>{statusLabel(decision.status)}</span>
              <p className="decision-note">{decision.note}</p>
              <span className="decision-meta">
                {[decision.decidedBy, decision.decidedAt ? new Date(decision.decidedAt).toLocaleString() : ""].filter(Boolean).join(" · ")}
              </span>
              {decision.status !== "DONE" ? (
                <ActionButton onClick={() => void markDone(decision.ItemId)}>{t("insights.decisions.markDone")}</ActionButton>
              ) : <span />}
              {completeFailedId === decision.ItemId ? (
                <p className="ledger-rejection decision-note" role="alert">{t("insights.decisions.completeError")}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

If `ActionButton` does not forward `type` or `disabled` to its `<button>`, report it rather than wrapping it — the fix belongs in `ActionButton`.

- [ ] **Step 5: Compose them in `InsightsPage.tsx`**

Add imports `import { AlertStrip } from "./AlertStrip";`, `import { DecisionLog } from "./DecisionLog";`, `import { useAlerts } from "./useAlerts";`, and replace the `Dashboard` function with:

```tsx
function Dashboard() {
  const { t } = useT();
  const reasonLabel = useReasonLabel();
  const { insights, loading, error, refetch } = useInsights();
  const alertState = useAlerts();

  return (
    <section className="insights-page">
      <PageHeader
        title={t("insights.title")}
        subtitle={t("insights.subtitle")}
        actions={
          <ActionButton
            variant="icon"
            onClick={() => { void refetch(); void alertState.refetch(); }}
            title={t("common.refresh")}
            icon={<RefreshCw size={18} />}
          />
        }
      />

      {/* Docked above the answer, per the spec: the alert is what arrived
          before the manager did. Independent of the insights fetch, so a slow
          aggregation never hides an alert. */}
      <AlertStrip
        alerts={alertState.alerts}
        loading={alertState.loading}
        error={alertState.error}
        onAcknowledge={alertState.acknowledge}
        onRetry={() => void alertState.refetch()}
      />

      {loading ? (
        <div className="panel">
          <Skeleton className="skeleton-line" style={{ width: "100%" }} />
          <Skeleton className="skeleton-line" style={{ width: "80%" }} />
          <Skeleton className="skeleton-line" style={{ width: "90%" }} />
        </div>
      ) : error ? (
        <ErrorState message={t("insights.loadError")} onRetry={() => refetch()} />
      ) : insights ? (
        <>
          <Answer insights={insights} />
          <div className="insights-facets">
            <FacetBars title={t("insights.facet.product")} facets={insights.byProduct} showRate />
            <FacetBars title={t("insights.facet.area")} facets={insights.byArea} showRate />
            <FacetBars title={t("insights.facet.courier")} facets={insights.byCourier} showRate />
            <FacetBars
              title={t("insights.facet.reason")}
              facets={insights.byReason}
              showRate={false}
              labelFor={(facet) => reasonLabel(facet.key)}
            />
          </div>
        </>
      ) : null}

      <DecisionLog alerts={alertState.alerts} />
    </section>
  );
}
```

- [ ] **Step 6: Styles** — append to `app/src/app/ledger.css`:

```css
/* ---- Pattern alerts --------------------------------------------------- */
.alert-strip { display: grid; gap: 10px; margin: 0 0 32px; }
.alert-card { background: var(--ledger-band); border-left: 3px solid var(--ledger-warn); display: grid; gap: 8px; padding: 14px 16px; }
.alert-card-quiet { background: transparent; border-left-color: var(--ledger-rule); color: var(--ledger-muted); }
.alert-sentence { font-family: var(--ledger-serif); font-size: 16.5px; line-height: 1.45; margin: 0; }
.alert-draft { font-family: var(--ledger-serif); font-size: 13.5px; font-style: italic; line-height: 1.55; margin: 2px 0 0; }
.alert-draft-label, .alert-meta { color: var(--ledger-faint); font-family: var(--ledger-mono); font-size: 11px; letter-spacing: 0.04em; }
.alert-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; }
.alert-strip-empty { color: var(--ledger-muted); font-family: var(--ledger-serif); font-style: italic; margin: 0 0 28px; }

/* ---- Decision log ----------------------------------------------------- */
.decision-log { border-top: 1px solid var(--ledger-rule); margin-top: 44px; padding-top: 22px; }
.decision-log-title { font-family: var(--ledger-serif); font-size: 21px; font-weight: 400; margin: 0 0 16px; }
.decision-form { display: grid; gap: 12px 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); margin-bottom: 26px; }
.decision-form label { color: var(--ledger-muted); display: grid; font-family: var(--ledger-mono); font-size: 11px; gap: 4px; letter-spacing: 0.04em; }
.decision-form select, .decision-form input, .decision-form textarea {
  background: var(--ledger-surface); border: 1px solid var(--ledger-rule); border-radius: 2px;
  color: var(--ledger-ink); font-family: var(--ledger-serif); font-size: 14px; min-width: 0; padding: 8px;
}
.decision-form-wide { grid-column: 1 / -1; }
.decision-rows { display: grid; }
.decision-row { align-items: center; border-bottom: 1px solid var(--ledger-rule); display: grid; gap: 4px 16px; grid-template-columns: minmax(0, 1fr) auto; padding: 12px 0; }
.decision-type { font-family: var(--ledger-mono); font-size: 12px; font-weight: 600; letter-spacing: 0.06em; overflow-wrap: anywhere; text-transform: uppercase; }
.decision-status-OPEN { color: var(--ledger-warn); }
.decision-status-DONE { color: var(--ledger-good); }
.decision-note { font-family: var(--ledger-serif); font-size: 14.5px; grid-column: 1 / -1; line-height: 1.5; margin: 0; }
.decision-meta { color: var(--ledger-faint); font-family: var(--ledger-mono); font-size: 11px; }
```

- [ ] **Step 7: Verify end to end as manager in the browser**

1. The SH-022 alert sits above the headline, with the draft label and a raised-at time.
2. Record a `COD_PAUSE` decision against it, target `Mirpur 11` — the third decision in the requirement's own scenario, joining the two already present. It appears at the top of the log as *open*.
3. Mark the size-chart decision done; it turns *done* and loses its button.
4. Acknowledge the alert; it goes quiet and names the manager.
5. Reload. All three changes persist.

- [ ] **Step 8: Lint, build, test, commit**

```bash
cd app && npm run lint && npm run build && npm test
cd .. && git add app/src/features/insights app/src/app/ledger.css
git commit -m "feat(insights): pattern alert strip and manager decision log"
```

- [ ] **Step 9: Leave the demo fixture ready**

The demo shows the manager arriving to an unacknowledged alert. As manager, headlessly reset `acknowledgedBy` to `""` on `ee6d9ac1-9451-4f2b-b9ea-e762fa7b3eaf` and read it back to confirm. Leave the recorded decisions in place.

---

### Task 7: Lock the boundaries with assertions

Two of these were carried over from the ops-console plan and are overdue; the third is new with this dashboard. All three pass **only on an authorisation denial**. A `400` means the probe itself is malformed and proves nothing.

**Files:**
- Modify: `tools/access-check/assertions.mjs`

- [ ] **Step 1: Add the auth-denial classifier** directly below `attempt()`:

```javascript
// A denial the platform intended, as opposed to a call it could not parse.
// Assertions 12-14 pass only on this: a 400 would prove the probe was
// malformed, not that the boundary held.
function isAuthDenial(result) {
  if (result.outcome === "threw") return /\b(401|403)\b/.test(result.message);
  if (result.outcome === "graphql-error") return /AUTH_|unauthori[sz]ed|forbidden|not authenticated/i.test(result.message);
  return false;
}
```

- [ ] **Step 2: Sign in the manager** — in `main()`, after the ops sign-in:

```javascript
  const { blocks: blocksManager } = await signIn(
    process.env.SHOPRETURN_MANAGER_EMAIL,
    process.env.SHOPRETURN_MANAGER_PASSWORD
  );
```

- [ ] **Step 3: Add assertions 12–14** after assertion 11's block, before the tally:

```javascript
  // 12. The timeline is the trust artifact: the permanent record of what the
  // customer was told and when. If a customer could append to it, it would
  // stop being the seller's word and be worthless as evidence for either side.
  {
    const label = "customerA cannot append to their own return's timeline";
    const result = await attempt(() =>
      blocksA.data.collection("ReturnTimeline").create({
        returnId: returnCaseItemId,
        customerItemId: customerAItemId,
        status: "REFUNDED",
        message: "assertion 12 probe -- a customer must never be able to write what the seller told them",
        isCustomerVisible: true,
        authorRole: "customer",
        at: new Date().toISOString()
      })
    );
    if (isAuthDenial(result)) {
      record(12, label, true, `denied(${result.message})`);
    } else if (result.outcome === "ok") {
      const payload = result.response?.data?.insertReturnTimeline;
      if (!payload?.itemId || payload.acknowledged === false) {
        record(12, label, true, `denied(empty) -- data.insertReturnTimeline=${JSON.stringify(payload)}`);
      } else {
        // No app identity can delete a timeline row (assertion 8), so this
        // debris is permanent. Report it; do not try to clean it up.
        record(12, label, false, `allowed -- customer-authored timeline row created (itemId=${payload.itemId}); it cannot be removed by any app role`);
      }
    } else {
      record(12, label, false, `inconclusive -- not an auth denial, check the probe shape: ${result.message}`);
    }
  }

  // 13. Ops cannot see pattern alerts or management decisions. An operator who
  // sees fraud and rate patterns would pre-judge the case in front of them --
  // exactly what "ops confirm or correct before it counts" exists to prevent.
  // The manager control proves the rows exist, so an empty result for ops is a
  // real denial and not the vacuous pass assertion 5 once was.
  {
    const label = "ops cannot read PatternAlert or Decision";
    const listOf = (client, schema, fields) =>
      attempt(() => client.data.collection(schema, { fields }).list({ pageNo: 1, pageSize: 5 }));

    const controlAlerts = await listOf(blocksManager, "PatternAlert", ["dimension", "value"]);
    const controlDecisions = await listOf(blocksManager, "Decision", ["decisionType", "target"]);
    const controlOk =
      controlAlerts.outcome === "ok" && itemsOf(controlAlerts.response, "getPatternAlerts").length > 0 &&
      controlDecisions.outcome === "ok" && itemsOf(controlDecisions.response, "getDecisions").length > 0;

    if (!controlOk) {
      record(13, label, false, "vacuous -- the manager control could not read rows in both collections, so an empty result for ops would prove nothing");
    } else {
      const verdict = (result, listField) => {
        if (isAuthDenial(result)) return { pass: true, note: `denied(${result.message})` };
        if (result.outcome === "ok") {
          const count = itemsOf(result.response, listField).length;
          return count === 0 ? { pass: true, note: "denied(empty)" } : { pass: false, note: `allowed -- ${count} row(s) visible` };
        }
        return { pass: false, note: `inconclusive -- not an auth denial: ${result.message}` };
      };
      const alerts = verdict(await listOf(blocksOps, "PatternAlert", ["dimension", "value"]), "getPatternAlerts");
      const decisions = verdict(await listOf(blocksOps, "Decision", ["decisionType", "target"]), "getDecisions");
      record(13, label, alerts.pass && decisions.pass, `PatternAlert ${alerts.note}; Decision ${decisions.note}`);
    }
  }

  // 14. The manager reads every case and decides none; ops owns the case
  // decision. Non-destructive by construction: the fixture case is already
  // REFUNDED, so even a wrongly-allowed write changes no value.
  {
    const label = "manager cannot edit a ReturnCase";
    const result = await attempt(() =>
      blocksManager.data.collection("ReturnCase").update(returnCaseItemId, { status: "REFUNDED" })
    );
    if (isAuthDenial(result)) {
      record(14, label, true, `denied(${result.message})`);
    } else if (result.outcome === "ok") {
      record(14, label, false, `allowed -- updateReturnCase=${JSON.stringify(result.response?.data?.updateReturnCase)}`);
    } else {
      record(14, label, false, `inconclusive -- not an auth denial, check the call shape: ${result.message}`);
    }
  }
```

- [ ] **Step 4: Make the tally count what ran**

Replace the hard-coded summary:

```javascript
  const passing = results.filter(Boolean).length;
  console.log(`${passing}/${results.length} passing`);
  process.exit(passing === results.length ? 0 : 1);
```

- [ ] **Step 5: Run the harness**

Run: `cd tools/access-check && node --env-file=.env assertions.mjs`
Expected: **13/14 passing**, with only #7 red by design (row-field rules are not evaluated on insert). Any other red: stop and report. Never change an assertion to match the behaviour you observed.

- [ ] **Step 6: Commit**

```bash
git add tools/access-check/assertions.mjs
git commit -m "test(access-check): assert timeline, pattern and manager-edit boundaries"
```

---

## What this plan does not build

- **Notifications** — customer submits → ops notified; alert raised → manager notified. Blocks' notifier is verified available and role-targeted, but it needs a tenant notification configuration created first (`blocks notification save --enable-persistence`, currently zero exist). Next plan.
- **The Pattern Watch agent** that raises alerts automatically. This plan reads alerts; the fixture alert stands in, and its `raisedAt` already predates any dashboard visit.
- **Photo evidence on returns.** Storage uploads fail platform-side (`{"errors":{"access":"forbidden"}}`) for every caller including the admin CLI token.
