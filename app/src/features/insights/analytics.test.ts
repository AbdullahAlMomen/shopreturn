import { describe, expect, it } from "vitest";
import { computeInsights, formatPercent, formatTaka } from "./analytics";

const orders = [
  { orderNumber: "1", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier" },
  { orderNumber: "2", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier" },
  { orderNumber: "3", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Gulshan 2", courier: "RedX" },
  { orderNumber: "4", sku: "BG-007", productName: "Leather Tote Bag", unitPrice: 4250, area: "Gulshan 2", courier: "RedX" }
];

const cases = [
  { orderNumber: "1", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DAMAGED_IN_TRANSIT" },
  { orderNumber: "4", sku: "BG-007", productName: "Leather Tote Bag", unitPrice: 4250, area: "Gulshan 2", courier: "RedX", confirmedReason: "CHANGED_MIND" }
];

describe("computeInsights", () => {
  it("computes return rate as returns over orders within the facet", () => {
    const sneaker = computeInsights(orders, cases).byProduct.find((f) => f.key === "SH-022");
    expect(sneaker?.orders).toBe(3);
    expect(sneaker?.returns).toBe(1);
    expect(sneaker?.rate).toBeCloseTo(1 / 3, 5);
  });

  it("computes taka impact as the summed unit price of returned items", () => {
    expect(computeInsights(orders, cases).byProduct.find((f) => f.key === "BG-007")?.takaImpact).toBe(4250);
  });

  it("ranks by taka impact, not rate", () => {
    const { byProduct } = computeInsights(orders, cases);
    expect(byProduct.map((f) => f.key)).toEqual(["BG-007", "SH-022"]);
  });

  it("prefers confirmedReason, falls back to aiReason, and never drops an uncategorised row", () => {
    const rows = [
      { orderNumber: "1", sku: "X", unitPrice: 10, aiReason: "WRONG_SIZE" },
      { orderNumber: "2", sku: "X", unitPrice: 10, aiReason: "WRONG_SIZE", confirmedReason: "DEFECTIVE" },
      { orderNumber: "3", sku: "X", unitPrice: 10 }
    ];
    expect(computeInsights([], rows).byReason.map((f) => f.key).sort()).toEqual(["DEFECTIVE", "UNCATEGORISED", "WRONG_SIZE"]);
  });

  it("gives reason facets no rate, because orders carry no reason", () => {
    expect(computeInsights(orders, cases).byReason.every((f) => f.rate === 0 && f.orders === 0)).toBe(true);
  });

  it("never divides by zero when a facet has returns but no orders", () => {
    const { byArea } = computeInsights([], [{ orderNumber: "9", area: "Ghost", unitPrice: 100 }]);
    expect(byArea[0]?.rate).toBe(0);
  });

  it("totals the whole dataset", () => {
    expect(computeInsights(orders, cases).totals).toEqual({ orders: 4, returns: 2, rate: 0.5, takaImpact: 5700 });
  });

  it("explains the costliest product from its own returns, not the global rankings", () => {
    const sneakerOnly = [
      { orderNumber: "1", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DAMAGED_IN_TRANSIT" },
      { orderNumber: "2", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DAMAGED_IN_TRANSIT" },
      { orderNumber: "3", sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Gulshan 2", courier: "RedX", confirmedReason: "WRONG_SIZE" },
      // A different product dominating Gulshan must not leak into SH-022's sentence.
      { orderNumber: "5", sku: "TS-104", productName: "Cotton T-Shirt", unitPrice: 890, area: "Gulshan 2", courier: "RedX", confirmedReason: "WRONG_SIZE" },
      { orderNumber: "6", sku: "TS-104", productName: "Cotton T-Shirt", unitPrice: 890, area: "Gulshan 2", courier: "RedX", confirmedReason: "WRONG_SIZE" }
    ];
    const { worst } = computeInsights([], sneakerOnly);
    expect(worst).toMatchObject({ area: "Mirpur 11", courier: "Sundarban Courier", pairCount: 2, reason: "DAMAGED_IN_TRANSIT" });
    expect(worst?.product.key).toBe("SH-022");
    expect(worst?.product.returns).toBe(3);
  });

  it("has no worst product when there are no returns", () => {
    expect(computeInsights(orders, []).worst).toBeUndefined();
  });
});

describe("formatters", () => {
  it("formats taka with grouping and the taka sign", () => {
    expect(formatTaka(44950)).toBe("৳44,950");
  });

  it("formats a fraction as a one-decimal percentage", () => {
    expect(formatPercent(31 / 82)).toBe("37.8%");
  });
});
