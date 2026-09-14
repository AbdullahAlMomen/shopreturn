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
