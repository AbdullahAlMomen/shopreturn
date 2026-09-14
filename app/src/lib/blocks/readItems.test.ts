import { describe, expect, it } from "vitest";
import { itemsOrThrow } from "./readItems";

type Row = { ItemId: string };

describe("itemsOrThrow", () => {
  it("returns the items for a normal response", () => {
    const response = { data: { getOrders: { items: [{ ItemId: "1" }, { ItemId: "2" }] } } };
    expect(itemsOrThrow<Row>(response, "getOrders")).toEqual([{ ItemId: "1" }, { ItemId: "2" }]);
  });

  it("returns [] when the list node is present with items: []", () => {
    const response = { data: { getOrders: { items: [] } } };
    expect(itemsOrThrow<Row>(response, "getOrders")).toEqual([]);
  });

  it("returns [] when the list node is present without items", () => {
    const response = { data: { getOrders: {} } };
    expect(itemsOrThrow<Row>(response, "getOrders")).toEqual([]);
  });

  it("throws on a non-empty errors array, with the error text included", () => {
    const response = { data: null, errors: [{ message: "not authorized" }] };
    expect(() => itemsOrThrow<Row>(response, "getOrders")).toThrow(/not authorized/);
    expect(() => itemsOrThrow<Row>(response, "getOrders")).toThrow(/getOrders/);
  });

  it("does not throw on an empty errors array", () => {
    const response = { data: { getOrders: { items: [] } }, errors: [] };
    expect(itemsOrThrow<Row>(response, "getOrders")).toEqual([]);
  });

  it("throws on isSuccess: false", () => {
    const response = { data: { getOrders: { items: [] } }, isSuccess: false };
    expect(() => itemsOrThrow<Row>(response, "getOrders")).toThrow(/getOrders/);
  });

  it("throws when data is null with an empty errors array", () => {
    const response = { data: null, errors: [] };
    expect(() => itemsOrThrow<Row>(response, "getOrders")).toThrow(/getOrders/);
  });

  it("throws when data is null on its own", () => {
    const response = { data: null };
    expect(() => itemsOrThrow<Row>(response, "getOrders")).toThrow(/getOrders/);
  });

  it("throws when the list node is absent, e.g. a renamed field", () => {
    const response = { data: { getOrdersRenamed: { items: [{ ItemId: "1" }] } } };
    expect(() => itemsOrThrow<Row>(response, "getOrders")).toThrow(/getOrders/);
  });
});
