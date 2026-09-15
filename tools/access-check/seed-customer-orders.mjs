import { readFile } from 'node:fs/promises';
import { signIn } from './client.mjs';

// Gives customer A and customer B fresh orders with no return on them, so each
// can submit a return in a demo. Inserted as ops (the only role that may create
// orders), owned via customerItemId -- the field customer-reads-own-orders keys
// on. No role can delete an Order, so these rows are permanent.
//
// Default is a DRY RUN: reads only, prints the plan and the effect on every
// facet currently over the alert threshold. Pass --apply to insert. Re-running
// is safe: order numbers that already exist are skipped.
//
// Nothing goes to Mirpur 11 or Sundarban Courier: both sit just over 30%, and
// extra orders there would pull the demo's live alerts below the line.
const APPLY = process.argv.includes('--apply');
const fixtureIds = JSON.parse(await readFile(new URL('./fixture-ids.json', import.meta.url), 'utf8'));

const PRODUCTS = {
  'SH-022': { productName: 'Canvas Sneaker', unitPrice: 1450 },
  'TS-104': { productName: 'Cotton T-Shirt', unitPrice: 890 },
  'DR-051': { productName: 'Linen Dress', unitPrice: 2150 },
  'DN-114': { productName: 'Slim Fit Denim', unitPrice: 2890 },
  'BG-007': { productName: 'Leather Tote Bag', unitPrice: 4250 }
};
const ROUTES = {
  Uttara: 'Paperfly',
  'Dhanmondi 27': 'Pathao Courier',
  'Gulshan 2': 'RedX',
  Bashundhara: 'eCourier'
};

const PLAN = [
  { who: 'A', orderNumber: '10-4826', sku: 'TS-104', area: 'Dhanmondi 27' },
  { who: 'A', orderNumber: '10-4827', sku: 'DR-051', area: 'Gulshan 2' },
  { who: 'A', orderNumber: '10-4828', sku: 'SH-022', area: 'Bashundhara' },
  { who: 'A', orderNumber: '10-4829', sku: 'DN-114', area: 'Uttara' },
  { who: 'A', orderNumber: '10-4830', sku: 'BG-007', area: 'Dhanmondi 27' },
  { who: 'B', orderNumber: '10-5002', sku: 'DN-114', area: 'Uttara' },
  { who: 'B', orderNumber: '10-5003', sku: 'BG-007', area: 'Bashundhara' },
  { who: 'B', orderNumber: '10-5004', sku: 'TS-104', area: 'Uttara' },
  { who: 'B', orderNumber: '10-5005', sku: 'DR-051', area: 'Gulshan 2' },
  { who: 'B', orderNumber: '10-5006', sku: 'SH-022', area: 'Dhanmondi 27' }
];

const OWNERS = {
  A: { customerItemId: fixtureIds.customerAItemId, customerEmail: process.env.SHOPRETURN_CUSTOMER_A_EMAIL },
  B: { customerItemId: fixtureIds.customerBItemId, customerEmail: process.env.SHOPRETURN_CUSTOMER_B_EMAIL }
};
for (const [who, owner] of Object.entries(OWNERS)) {
  if (!owner.customerItemId || !owner.customerEmail) {
    console.log(`ABORT: customer ${who} item id or email missing (fixture-ids.json / .env). Nothing was written.`);
    process.exit(1);
  }
}

async function listAll(client, schema, fields) {
  const out = [];
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const res = await client.data.collection(schema, { fields }).list({ pageNo, pageSize: 100 });
    if (Array.isArray(res?.errors) && res.errors.length > 0) {
      throw new Error(`${schema} list failed: ${JSON.stringify(res.errors).slice(0, 200)}`);
    }
    const items = res?.data?.[`get${schema}s`]?.items;
    if (!Array.isArray(items)) throw new Error(`${schema} list returned no items array`);
    out.push(...items);
    if (items.length < 100) return out;
  }
  throw new Error(`${schema} has more than 5000 rows; refusing to guess`);
}

const { blocks: ops } = await signIn(process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD);
const orders = await listAll(ops, 'Order', ['orderNumber', 'sku', 'area', 'courier']);
const cases = await listAll(ops, 'ReturnCase', ['sku', 'area', 'courier']);
const existing = new Set(orders.map((o) => o.orderNumber));

const rows = PLAN.map((p) => ({ ...p, ...PRODUCTS[p.sku], courier: ROUTES[p.area], exists: existing.has(p.orderNumber) }));
const toInsert = rows.filter((r) => !r.exists);

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} -- ${toInsert.length} to insert, ${rows.length - toInsert.length} already present`);
for (const r of rows) {
  console.log(`  customer ${r.who} ${r.orderNumber} ${r.sku} ${r.productName} ৳${r.unitPrice} ${r.area} / ${r.courier}${r.exists ? '  (exists, skip)' : ''}`);
}

// Same rule as Pattern Watch: at least 20 orders and a rate of at least 30%.
// A return counts regardless of status, as in computeInsights.
function facetRates(orderRows) {
  const out = [];
  for (const dim of ['sku', 'area', 'courier']) {
    const counts = {};
    for (const o of orderRows) counts[o[dim]] = (counts[o[dim]] ?? 0) + 1;
    for (const [value, n] of Object.entries(counts)) {
      const returned = cases.filter((c) => c[dim] === value).length;
      out.push({ key: `${dim}:${value}`, n, returned, rate: n ? returned / n : 0 });
    }
  }
  return out;
}
const after = new Map(facetRates([...orders, ...toInsert]).map((f) => [f.key, f]));
let dropsBelow = 0;
console.log('facets over the threshold now:');
for (const f of facetRates(orders).filter((x) => x.n >= 20 && x.rate >= 0.3)) {
  const a = after.get(f.key);
  const still = a.n >= 20 && a.rate >= 0.3;
  if (!still) dropsBelow++;
  console.log(`  ${f.key} ${(f.rate * 100).toFixed(1)}% (${f.returned}/${f.n}) -> ${(a.rate * 100).toFixed(1)}% (${a.returned}/${a.n})${still ? '' : '  DROPS BELOW 30%'}`);
}
if (dropsBelow > 0) {
  console.log(`ABORT: ${dropsBelow} facet(s) would drop below the threshold. Nothing was written.`);
  process.exit(1);
}
if (!APPLY) process.exit(0);

let failed = 0;
for (const r of toInsert) {
  const owner = OWNERS[r.who];
  try {
    const res = await ops.data.collection('Order').create({
      orderNumber: r.orderNumber,
      sku: r.sku,
      productName: r.productName,
      unitPrice: r.unitPrice,
      area: r.area,
      courier: r.courier,
      customerItemId: owner.customerItemId,
      customerEmail: owner.customerEmail
    });
    const itemId = res?.data?.insertOrder?.itemId;
    if ((Array.isArray(res?.errors) && res.errors.length > 0) || !itemId) {
      failed++;
      console.log(`FAILED ${r.orderNumber}: ${JSON.stringify(res?.errors ?? res).slice(0, 200)}`);
    } else {
      console.log(`inserted ${r.orderNumber} (itemId=${itemId})`);
    }
  } catch (error) {
    failed++;
    console.log(`FAILED ${r.orderNumber}: ${error.message}`);
  }
}

// Read back as each customer: the new orders must be visible to their owner only.
for (const who of ['A', 'B']) {
  const { blocks } = await signIn(process.env[`SHOPRETURN_CUSTOMER_${who}_EMAIL`], process.env[`SHOPRETURN_CUSTOMER_${who}_PASSWORD`]);
  const mine = await listAll(blocks, 'Order', ['orderNumber']);
  const claimed = new Set((await listAll(blocks, 'ReturnCase', ['orderNumber'])).map((c) => c.orderNumber));
  const visible = new Set(mine.map((o) => o.orderNumber));
  const missing = PLAN.filter((p) => p.who === who && !visible.has(p.orderNumber)).map((p) => p.orderNumber);
  const leaked = PLAN.filter((p) => p.who !== who && visible.has(p.orderNumber)).map((p) => p.orderNumber);
  if (missing.length || leaked.length) failed++;
  const eligible = mine.filter((o) => !claimed.has(o.orderNumber)).map((o) => o.orderNumber);
  console.log(`customer ${who}: sees ${mine.length} orders; eligible for a return: ${eligible.join(', ') || 'none'}${missing.length ? `; MISSING ${missing.join(', ')}` : ''}${leaked.length ? `; LEAKED ${leaked.join(', ')}` : ''}`);
}
process.exit(failed ? 1 : 0);
