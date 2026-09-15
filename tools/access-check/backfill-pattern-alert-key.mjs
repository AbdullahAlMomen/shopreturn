import { signIn } from './client.mjs';

// One-off migration: give the pre-existing SH-022 fixture alert its alertKey
// so the first Pattern Watch run does not raise a duplicate SH-022 alert.
// isoWeek matches app/src/features/insights/patternWatch.ts exactly.
const ALERT_ID = 'ee6d9ac1-9451-4f2b-b9ea-e762fa7b3eaf';

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const weekYear = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(weekYear, 0, 1)) / 86400000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

const key = `SKU:SH-022:${isoWeek(new Date())}`;
const { blocks: manager } = await signIn(process.env.SHOPRETURN_MANAGER_EMAIL, process.env.SHOPRETURN_MANAGER_PASSWORD);

const res = await manager.data.collection('PatternAlert').update(ALERT_ID, { alertKey: key });
const failed = (Array.isArray(res?.errors) && res.errors.length > 0) || res?.isSuccess === false || !res?.data?.updatePatternAlert?.itemId;
if (failed) {
  console.log('BACKFILL FAILED', JSON.stringify(res).slice(0, 300));
  process.exit(1);
}

const list = await manager.data.collection('PatternAlert', { fields: ['alertKey', 'dimension', 'value'] }).list({ pageNo: 1, pageSize: 50 });
const rows = list?.data?.getPatternAlerts?.items ?? [];
const fixture = rows.find((row) => row.ItemId === ALERT_ID);
console.log('fixture alertKey now:', fixture?.alertKey);
console.log('alerts total:', rows.length);
process.exit(fixture?.alertKey === key ? 0 : 1);
