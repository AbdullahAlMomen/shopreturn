import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";

// Everything the dropdown needs to render a recognisable row (order number,
// product name, price) and everything useSubmitReturn needs to carry onto
// the new ReturnCase without a second lookup -- see NewReturnPage.tsx.
export type EligibleOrder = {
  orderNumber: string;
  sku?: string;
  productName?: string;
  unitPrice?: number;
  area?: string;
  courier?: string;
};

const ORDER_FIELDS = ["orderNumber", "sku", "productName", "unitPrice", "area", "courier"];

type OrderRow = Partial<EligibleOrder>;

type ListOrdersResponse = { data?: { getOrders?: { items?: OrderRow[] } } };
type ListReturnCasesResponse = { data?: { getReturnCases?: { items?: { orderNumber?: string }[] } } };

// Eligible = the signed-in customer's own orders that do not already have a
// ReturnCase. Both `Order` and `ReturnCase` lists are already scoped to the
// caller by the deployed read policies (customer-reads-own-orders /
// customer-reads-own-returns) -- this deliberately adds no ownership filter
// of its own, it only subtracts orders that already appear on one of the
// customer's own ReturnCase rows.
export function useEligibleOrders() {
  const [orders, setOrders] = useState<EligibleOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [ordersResponse, returnsResponse] = await Promise.all([
        blocksClient.data
          .collection("Order", { fields: ORDER_FIELDS })
          .list({ pageNo: 1, pageSize: 100 }) as Promise<ListOrdersResponse>,
        blocksClient.data
          .collection("ReturnCase", { fields: ["orderNumber"] })
          .list({ pageNo: 1, pageSize: 100 }) as Promise<ListReturnCasesResponse>
      ]);

      const allOrders = ordersResponse?.data?.getOrders?.items ?? [];
      const claimedOrderNumbers = new Set(
        (returnsResponse?.data?.getReturnCases?.items ?? [])
          .map((item) => item.orderNumber)
          .filter((value): value is string => Boolean(value))
      );

      const eligible = allOrders.filter(
        (order): order is EligibleOrder => Boolean(order.orderNumber) && !claimedOrderNumbers.has(order.orderNumber as string)
      );
      setOrders(eligible);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { orders, loading, error, refetch: load };
}
