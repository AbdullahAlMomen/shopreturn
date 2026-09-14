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
