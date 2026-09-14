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
