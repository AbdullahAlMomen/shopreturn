import { describe, expect, it } from "vitest";
import type { CaseRow, Facet, Insights } from "./analytics";
import {
  buildAlert,
  buildAlertKey,
  classifyAlertInsert,
  draftExplanation,
  findBreaches,
  isoWeek
} from "./patternWatch";

function facet(key: string, orders: number, returns: number, takaImpact = 0, label = key): Facet {
  return { key, label, orders, returns, rate: orders > 0 ? returns / orders : 0, takaImpact };
}

function insightsWith(parts: Partial<Pick<Insights, "byProduct" | "byArea" | "byCourier">>): Insights {
  return {
    totals: { orders: 0, returns: 0, rate: 0, takaImpact: 0 },
    byProduct: parts.byProduct ?? [],
    byArea: parts.byArea ?? [],
    byCourier: parts.byCourier ?? [],
    byReason: []
  };
}

function rows(count: number, row: CaseRow, idPrefix: string): CaseRow[] {
  return Array.from({ length: count }, (_, i) => ({ ...row, ItemId: `${idPrefix}-${i}` }));
}

const sneakerCases: CaseRow[] = [
  ...rows(24, { sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DAMAGED_IN_TRANSIT" }, "hot"),
  ...rows(7, { sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Gulshan 2", courier: "RedX", confirmedReason: "WRONG_SIZE" }, "cold")
];

const mirpurCases: CaseRow[] = [
  ...rows(24, { sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DAMAGED_IN_TRANSIT" }, "m"),
  ...rows(2, { sku: "TS-104", productName: "Cotton T-Shirt", unitPrice: 890, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DEFECTIVE" }, "t")
];

describe("findBreaches", () => {
  it("flags a facet at exactly the threshold with enough orders", () => {
    expect(findBreaches(insightsWith({ byProduct: [facet("A", 20, 6)] }))).toHaveLength(1);
  });

  it("ignores a facet just below the threshold", () => {
    expect(findBreaches(insightsWith({ byProduct: [facet("A", 100, 29)] }))).toHaveLength(0);
  });

  it("ignores a facet with fewer than the minimum orders, however high its rate", () => {
    expect(findBreaches(insightsWith({ byProduct: [facet("A", 19, 19)] }))).toHaveLength(0);
  });

  it("never alerts on the UNSPECIFIED bucket", () => {
    expect(findBreaches(insightsWith({ byArea: [facet("UNSPECIFIED", 50, 40)] }))).toHaveLength(0);
  });

  it("checks all three dimensions and labels each breach with its dimension", () => {
    const breaches = findBreaches(insightsWith({
      byProduct: [facet("SH-022", 82, 31)],
      byArea: [facet("Mirpur 11", 84, 26)],
      byCourier: [facet("Sundarban Courier", 84, 26)]
    }));
    expect(breaches.map((b) => `${b.dimension}:${b.facet.key}`)).toEqual([
      "SKU:SH-022",
      "AREA:Mirpur 11",
      "COURIER:Sundarban Courier"
    ]);
  });
});

describe("isoWeek", () => {
  it("numbers a mid-year date", () => {
    expect(isoWeek(new Date("2026-09-15T08:00:00Z"))).toBe("2026-W38");
  });

  it("puts 29 Dec 2025 in week 1 of 2026 (week-year differs from calendar year)", () => {
    expect(isoWeek(new Date("2025-12-29T12:00:00Z"))).toBe("2026-W01");
  });

  it("puts 1 Jan 2027 in week 53 of 2026", () => {
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
});

describe("buildAlertKey", () => {
  it("joins dimension, facet key and ISO week", () => {
    expect(buildAlertKey("AREA", "Mirpur 11", new Date("2026-09-15T08:00:00Z"))).toBe("AREA:Mirpur 11:2026-W38");
  });
});

describe("draftExplanation", () => {
  it("explains a SKU from its own returns", () => {
    expect(draftExplanation("SKU", facet("SH-022", 82, 31, 44950, "Canvas Sneaker"), sneakerCases)).toBe(
      "31 of 82 Canvas Sneaker (SH-022) orders were returned (37.8%), ৳44,950. Most came from Mirpur 11 via Sundarban Courier, most often damaged in transit."
    );
  });

  it("explains an area by the product and courier behind it", () => {
    expect(draftExplanation("AREA", facet("Mirpur 11", 84, 26, 38590), mirpurCases)).toBe(
      "26 of 84 orders in Mirpur 11 were returned (31.0%), ৳38,590. Most were Canvas Sneaker (SH-022) via Sundarban Courier, most often damaged in transit."
    );
  });

  it("explains a courier by the product and area behind it", () => {
    expect(draftExplanation("COURIER", facet("Sundarban Courier", 84, 26, 38590), mirpurCases)).toBe(
      "26 of 84 Sundarban Courier orders were returned (31.0%), ৳38,590. Most were Canvas Sneaker (SH-022) in Mirpur 11, most often damaged in transit."
    );
  });

  it("omits the place clause when the facet's returns record no area or courier", () => {
    const bare = rows(6, { sku: "X-1", unitPrice: 100, confirmedReason: "DEFECTIVE" }, "b");
    expect(draftExplanation("SKU", facet("X-1", 20, 6, 600), bare)).toBe(
      "6 of 20 X-1 orders were returned (30.0%), ৳600. Most often defective."
    );
  });

  it("ignores other facets' returns entirely", () => {
    const mixed = [...sneakerCases, ...rows(40, { sku: "TS-104", area: "Uttara", courier: "Paperfly", confirmedReason: "WRONG_SIZE" }, "x")];
    expect(draftExplanation("SKU", facet("SH-022", 82, 31, 44950, "Canvas Sneaker"), mixed)).toContain("Mirpur 11 via Sundarban Courier");
  });
});

describe("buildAlert", () => {
  it("builds every stored field from the breach and its own returns", () => {
    const other = rows(3, { sku: "TS-104", area: "Uttara", courier: "Paperfly" }, "other");
    const alert = buildAlert(
      { dimension: "SKU", facet: facet("SH-022", 82, 31, 44950, "Canvas Sneaker") },
      [...sneakerCases, ...other],
      new Date("2026-09-15T08:00:00Z")
    );
    expect(alert.alertKey).toBe("SKU:SH-022:2026-W38");
    expect(alert.dimension).toBe("SKU");
    expect(alert.value).toBe("SH-022");
    expect(alert.metric).toBe(37.8);
    expect(alert.threshold).toBe(30);
    expect(alert.takaImpact).toBe(44950);
    expect(alert.contributingReturnIds).toHaveLength(31);
    expect(alert.contributingReturnIds.some((id) => id.startsWith("other"))).toBe(false);
    expect(alert.raisedAt).toBe("2026-09-15T08:00:00.000Z");
    expect(alert.acknowledgedBy).toBe("");
    expect(alert.draftExplanation.length).toBeGreaterThan(0);
  });
});

describe("classifyAlertInsert", () => {
  it("recognises a successful insert", () => {
    expect(classifyAlertInsert({ data: { insertPatternAlert: { itemId: "a1", acknowledged: true } } })).toBe("inserted");
  });

  it("treats a uniqueness rejection on alertKey as already raised, not a failure", () => {
    expect(classifyAlertInsert({
      data: { insertPatternAlert: null },
      errors: [{ message: "A record with the same value for 'alertKey' already exists." }]
    })).toBe("duplicate");
  });

  it("treats any other error as a failure", () => {
    expect(classifyAlertInsert({ errors: [{ message: "AUTH_NOT_AUTHENTICATED" }] })).toBe("failed");
  });

  it("treats a null payload with no errors as a failure", () => {
    expect(classifyAlertInsert({ data: { insertPatternAlert: null } })).toBe("failed");
  });

  it("treats an unacknowledged payload as a failure", () => {
    expect(classifyAlertInsert({ data: { insertPatternAlert: { itemId: "a1", acknowledged: false } } })).toBe("failed");
  });
});
