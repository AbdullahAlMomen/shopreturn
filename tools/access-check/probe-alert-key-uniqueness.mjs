import { signIn } from './client.mjs';

// Proves two things at once with zero debris: ops' insert right on
// PatternAlert is live, and alertKey uniqueness is enforced. An ops insert
// reusing the fixture's key must be REJECTED FOR UNIQUENESS -- which it can
// only be if the insert policy let it through to that check. A 401 means the
// policy is not live. A created row means uniqueness is not enforced, and
// because no role can delete an alert, that row would be permanent: report it.
const ALERT_ID = 'ee6d9ac1-9451-4f2b-b9ea-e762fa7b3eaf';

const { blocks: manager } = await signIn(process.env.SHOPRETURN_MANAGER_EMAIL, process.env.SHOPRETURN_MANAGER_PASSWORD);
const list = await manager.data.collection('PatternAlert', { fields: ['alertKey'] }).list({ pageNo: 1, pageSize: 50 });
const key = (list?.data?.getPatternAlerts?.items ?? []).find((row) => row.ItemId === ALERT_ID)?.alertKey;
if (!key) {
  console.log('ABORT: the fixture alert has no alertKey yet -- run the backfill first. Nothing was inserted.');
  process.exit(1);
}

const { blocks: ops } = await signIn(process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD);
let res;
try {
  res = await ops.data.collection('PatternAlert').create({
    alertKey: key, dimension: 'SKU', value: 'SH-022', metric: 0, threshold: 30, takaImpact: 0,
    contributingReturnIds: [], draftExplanation: 'uniqueness probe -- must be rejected',
    raisedAt: new Date().toISOString(), acknowledgedBy: ''
  });
} catch (error) {
  const denied = /\b(401|403)\b/.test(error.message);
  console.log(denied ? 'FAIL: ops insert DENIED -- the policy is not live' : `INCONCLUSIVE: ${error.message}`);
  process.exit(1);
}

const errors = JSON.stringify(res?.errors ?? []);
const created = res?.data?.insertPatternAlert?.itemId;
if (created) {
  console.log(`FAIL: a duplicate alert was CREATED (itemId=${created}) -- uniqueness is not enforced. No role can delete it; remove it by hand.`);
  process.exit(1);
}
if (errors.includes('alertKey') && errors.toLowerCase().includes('already exists')) {
  console.log('PASS: ops insert reached the uniqueness check and was rejected for a duplicate alertKey. Nothing was created.');
  process.exit(0);
}
console.log('INCONCLUSIVE:', JSON.stringify(res).slice(0, 300));
process.exit(1);
