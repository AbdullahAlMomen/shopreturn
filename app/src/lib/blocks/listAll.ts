import { blocksClient } from "./client";
import { itemsOrThrow } from "./readItems";

const PAGE_SIZE = 100;

// MAX_PAGES is a data limit, not a runaway guard: a collection bigger than
// this throws rather than letting a caller reduce over a partial set.
// Counting only some orders would inflate every return rate built on them.
const MAX_PAGES = 50;

export async function listAll<T>(schema: string, fields: string[]): Promise<T[]> {
  const listField = `get${schema}s`;
  const rows: T[] = [];
  let lastPageWasFull = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // Oldest first: new inserts land at the end, so skip/limit paging stays
    // stable even if rows are added while this loop runs.
    const response = await blocksClient.data
      .collection(schema, { fields })
      .list({ pageNo: page, pageSize: PAGE_SIZE, sort: { CreatedDate: 1 } });
    const items = itemsOrThrow<T>(response, listField);
    rows.push(...items);
    lastPageWasFull = items.length === PAGE_SIZE;
    if (!lastPageWasFull) break;
  }
  if (lastPageWasFull) {
    throw new Error(
      `${schema} exceeds ${MAX_PAGES * PAGE_SIZE} rows; refusing to reduce over a partial set, ` +
      "because counting only some rows would misstate every rate built on them"
    );
  }
  return rows;
}
