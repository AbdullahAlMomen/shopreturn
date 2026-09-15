import { listAll } from "../../lib/blocks/listAll";
import type { CaseRow, OrderRow } from "./analytics";

// The single definition of what the dashboard and Pattern Watch read, so an
// alert and the Analytics page can never be computed from different fields.
export const ORDER_FIELDS = ["orderNumber", "sku", "productName", "unitPrice", "area", "courier"];
export const CASE_FIELDS = [...ORDER_FIELDS, "status", "confirmedReason", "aiReason"];

export async function loadInsightsData(): Promise<{ orders: OrderRow[]; cases: CaseRow[] }> {
  // No ownership filter: manager and ops legitimately read every order and
  // case, and the read policies decided that server-side.
  const [orders, cases] = await Promise.all([
    listAll<OrderRow>("Order", ORDER_FIELDS),
    listAll<CaseRow>("ReturnCase", CASE_FIELDS)
  ]);
  return { orders, cases };
}
