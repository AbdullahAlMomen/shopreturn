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
