import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { itemsOrThrow } from "../../lib/blocks/readItems";

export type ReturnRow = {
  ItemId: string;
  orderNumber?: string;
  sku?: string;
  productName?: string;
  status?: string;
  unitPrice?: number;
  rawCustomerText?: string;
  rejectionReason?: string;
  // Platform-managed system field (PascalCase, undeclared in the ReturnCase
  // schema JSON but selectable) -- confirmed live: CreatedDate resolves,
  // createdDate 400s. Used for the "age" column.
  CreatedDate?: string;
};

// Only fields the customer is allowed to read. The ai* columns are masked by
// policy -- confirmed live: masked fields don't error, they resolve to null
// -- so they must never appear here even though asking wouldn't throw.
const FIELDS = [
  "orderNumber", "sku", "productName", "status",
  "unitPrice", "rawCustomerText", "rejectionReason", "CreatedDate"
];

export function useMyReturns() {
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await blocksClient.data
        .collection("ReturnCase", { fields: FIELDS })
        .list({ pageNo: 1, pageSize: 50 });
      setReturns(itemsOrThrow<ReturnRow>(response, "getReturnCases"));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { returns, loading, error, refetch: load };
}
