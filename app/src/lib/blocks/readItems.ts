// The Blocks SDK's data client throws only on a non-2xx HTTP status (see
// @seliseblocks/client http-client.js) -- it passes a 200 body through
// unchanged even when that body is `{ data: null, errors: [...] }`, or
// carries `isSuccess: false`. Every list hook used to read
// `response?.data?.getXs?.items ?? []`, so a failed, forbidden or renamed
// read silently became `[]`, and the page stated a falsehood ("no returns
// recorded yet", no alerts, no decisions). This is the one place that
// decides that: an empty list must mean empty, never failed.

type ListNode = { items?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeError(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return String(error);
}

export function itemsOrThrow<T>(response: unknown, listField: string): T[] {
  const body = isRecord(response) ? response : {};

  const errors = body.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const messages = errors.map(describeError).join("; ");
    throw new Error(`Read of "${listField}" failed: ${messages}`);
  }

  if (body.isSuccess === false) {
    throw new Error(`Read of "${listField}" failed: response reported isSuccess: false`);
  }

  const data = isRecord(body.data) ? body.data : undefined;
  const listNode = data?.[listField];

  if (listNode === null || listNode === undefined) {
    throw new Error(
      `Read of "${listField}" failed: the list was missing from the response ` +
      "(a missing list node means a failed or renamed read, not an empty result)"
    );
  }

  const node = listNode as ListNode;
  const items = isRecord(node) && Array.isArray(node.items) ? node.items : [];
  return items as T[];
}
