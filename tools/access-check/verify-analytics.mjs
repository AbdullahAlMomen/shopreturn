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

// Per-SKU targets, exact orders for every SKU. Returns/taka are exact for
// most SKUs; DN-114 and BG-007 get demoSlack=1 because their source orders
// are customer A's demo-eligible 10-4824 and 10-4825 -- a tester could
// legitimately turn one of those into a real return between seed and
// verify, which would add exactly one return at that SKU's unit price.
// SH-022 deliberately gets demoSlack=0: its PatternAlert fixture hard-codes
// 31 returns / 38% / taka 44950, so a stray demo return elsewhere for
// SH-022 (e.g. customer B's 10-5001) must fail this check loudly rather
// than pass under a widened tolerance.
const TARGETS = [
  { sku: 'SH-022', orders: 82, returns: 31, taka: 44950, unitPrice: 1450, demoSlack: 0 },
  { sku: 'DN-114', orders: 55, returns: 11, taka: 31790, unitPrice: 2890, demoSlack: 1 },
  { sku: 'DR-051', orders: 64, returns: 9, taka: 19350, unitPrice: 2150, demoSlack: 0 },
  { sku: 'TS-104', orders: 120, returns: 14, taka: 12460, unitPrice: 890, demoSlack: 0 },
  { sku: 'BG-007', orders: 40, returns: 3, taka: 12750, unitPrice: 4250, demoSlack: 1 }
];

for (const t of TARGETS) {
  const s = bySku(t.sku);
  check(`${t.sku} has exactly ${t.orders} orders`, s.orders === t.orders, String(s.orders));
  const maxReturns = t.returns + t.demoSlack;
  const expectedTaka = t.taka + (s.returns - t.returns) * t.unitPrice;
  check(
    `${t.sku} returns are ${t.returns}${t.demoSlack ? `..${maxReturns}` : ' (exact)'} with taka matching exactly`,
    s.returns >= t.returns && s.returns <= maxReturns && s.taka === expectedTaka,
    `returns=${s.returns} taka=${s.taka}`
  );
}

const totalSlackReturns = TARGETS.reduce((sum, t) => sum + t.demoSlack, 0);
const totalSlackTaka = TARGETS.reduce((sum, t) => sum + t.demoSlack * t.unitPrice, 0);
const totalTaka = cases.reduce((sum, row) => sum + (row.unitPrice ?? 0), 0);
check('total orders is exactly 361', orders.length === 361, String(orders.length));
check(
  `total returns is in [68, ${68 + totalSlackReturns}]`,
  cases.length >= 68 && cases.length <= 68 + totalSlackReturns,
  String(cases.length)
);
check(
  `total taka is in [121300, ${121300 + totalSlackTaka}]`,
  totalTaka >= 121300 && totalTaka <= 121300 + totalSlackTaka,
  String(totalTaka)
);

const passing = results.filter(Boolean).length;
console.log(`${passing}/${results.length} passing (orders=${orders.length}, returns=${cases.length})`);
process.exit(passing === results.length ? 0 : 1);
