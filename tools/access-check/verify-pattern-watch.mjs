import { signIn } from './client.mjs';

// Read-only end-to-end check, run AFTER a human has (1) submitted a return as
// customer A and (2) accepted it as ops on the deployed site. It never writes.
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const weekYear = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(weekYear, 0, 1)) / 86400000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

// Usage: verify-pattern-watch.mjs [orderNumber] [isoWeek]. The week defaults to
// the current UTC ISO week; pass the week of the accept when running later.
const orderNumber = process.argv[2];
const week = process.argv[3] ?? isoWeek(new Date());
const SH022_FIXTURE_ID = 'ee6d9ac1-9451-4f2b-b9ea-e762fa7b3eaf';
console.log(`checking ISO week ${week}`);
const results = [];
const check = (label, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${label} -- ${detail}`); };

const { blocks: manager } = await signIn(process.env.SHOPRETURN_MANAGER_EMAIL, process.env.SHOPRETURN_MANAGER_PASSWORD);
const { blocks: ops } = await signIn(process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD);

const alertList = await manager.data.collection('PatternAlert', {
  fields: ['alertKey', 'dimension', 'value', 'metric', 'threshold', 'draftExplanation', 'contributingReturnIds']
}).list({ pageNo: 1, pageSize: 100 });
const alerts = alertList?.data?.getPatternAlerts?.items ?? [];

for (const [dimension, value] of [['AREA', 'Mirpur 11'], ['COURIER', 'Sundarban Courier']]) {
  const key = `${dimension}:${value}:${week}`;
  const matches = alerts.filter((a) => a.alertKey === key);
  const a = matches[0];
  check(`exactly one alert ${key}`, matches.length === 1, `found ${matches.length}`);
  if (a) {
    check(`${key} fields`, a.dimension === dimension && a.value === value && a.threshold === 30 && a.metric >= 30,
      `dimension=${a.dimension} value=${a.value} metric=${a.metric} threshold=${a.threshold}`);
    check(`${key} explanation drafted`, typeof a.draftExplanation === 'string' && a.draftExplanation.includes(value), a.draftExplanation);
    check(`${key} links its returns`, Array.isArray(a.contributingReturnIds) && a.contributingReturnIds.length > 0, `${a.contributingReturnIds?.length ?? 0} ids`);
  }
}
// Uniqueness alone makes "one row per key" vacuous. The real question is
// whether the week's SH-022 key belongs to the backfilled fixture; if not,
// Pattern Watch raised a second SH-022 alert beside it.
const shKey = `SKU:SH-022:${week}`;
const shRow = alerts.find((a) => a.alertKey === shKey);
check('SH-022 not duplicated', shRow?.ItemId === SH022_FIXTURE_ID && alerts.filter((a) => a.value === 'SH-022').length === 1,
  `key owner=${shRow?.ItemId ?? 'none'}, SH-022 rows=${alerts.filter((a) => a.value === 'SH-022').length}`);

const inbox = async (client) => (await client.notifier.getNotifications({ page: 0, pageSize: 50 }))?.notifications ?? [];
const payloadOf = (n) => {
  const raw = n?.denormalizedPayload;
  if (raw && typeof raw === 'object') return raw;
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
};
const managerInbox = await inbox(manager);
for (const [dimension, value] of [['AREA', 'Mirpur 11'], ['COURIER', 'Sundarban Courier']]) {
  const key = `${dimension}:${value}:${week}`;
  // Exactly one: zero means no ping, two means a duplicate insert still notified.
  const hits = managerInbox.filter((n) => { const p = payloadOf(n); return p.kind === 'PATTERN_ALERT' && p.alertKey === key; });
  check(`manager notified once about ${key}`, hits.length === 1, `found ${hits.length} on page 0`);
}

if (orderNumber) {
  const opsInbox = await inbox(ops);
  const hits = opsInbox.filter((n) => { const p = payloadOf(n); return p.kind === 'RETURN_SUBMITTED' && p.orderNumber === orderNumber; });
  check(`ops notified once about order ${orderNumber}`, hits.length === 1, `found ${hits.length} on page 0`);
}

const passing = results.filter(Boolean).length;
console.log(`${passing}/${results.length} passing`);
process.exit(passing === results.length ? 0 : 1);
