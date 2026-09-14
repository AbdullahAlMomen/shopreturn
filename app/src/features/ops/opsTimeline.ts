import { blocksClient } from "../../lib/blocks/client";

// Shared write-path helpers for every ops case-action hook (useReviewReturn,
// useInspection, useRefund). Task 2's useReviewReturn.ts defined these
// locally; Task 3 adds two more hooks that need the exact same "a 200 can
// still be a failure" check and the exact same ReturnTimeline insert shape,
// so this moved out rather than being copied a third and fourth time.

export type GraphQLError = { message?: string };

export type MutationPayload = { itemId?: string; acknowledged?: boolean } | null | undefined;

// A 200 can still be a failure: check for a GraphQL `errors` array, an
// `isSuccess: false` flag, AND a null/unacknowledged mutation payload before
// trusting any write. Five distinct shapes of this have appeared in this
// project (see useSubmitReturn.ts, useReviewReturn.ts, and the SDK passing a
// 200-with-errors body through unchanged) -- this is the one checker every
// ops write now shares.
export function mutationFailed(
  response: { errors?: GraphQLError[]; isSuccess?: boolean } | undefined,
  payload: MutationPayload
): boolean {
  if (response && Array.isArray(response.errors) && response.errors.length > 0) return true;
  if (response?.isSuccess === false) return true;
  if (!payload?.itemId || payload.acknowledged === false) return true;
  return false;
}

export type TimelineInsertInput = {
  returnId: string;
  customerItemId: string;
  status: string;
  message: string;
};

type InsertReturnTimelineResponse = {
  data?: { insertReturnTimeline?: { acknowledged?: boolean; itemId?: string } | null };
  errors?: GraphQLError[];
};

// Copies customerItemId from the parent ReturnCase, never from the caller's
// own identity -- child-row read policies key on customerItemId, not
// CreatedBy (unlike ReturnCase itself). Using anything else makes the entry
// permanently invisible to the customer it's meant for.
export async function insertTimelineEntry(input: TimelineInsertInput): Promise<boolean> {
  const response = (await blocksClient.data.collection("ReturnTimeline").create({
    returnId: input.returnId,
    customerItemId: input.customerItemId,
    at: new Date().toISOString(),
    status: input.status,
    isCustomerVisible: true,
    authorRole: "ops",
    message: input.message
  })) as InsertReturnTimelineResponse;
  return !mutationFailed(response, response?.data?.insertReturnTimeline);
}

type UpdateReturnCaseResponse = {
  data?: { updateReturnCase?: { acknowledged?: boolean; itemId?: string } | null };
  errors?: GraphQLError[];
};

export async function updateReturnCaseStatus(itemId: string, fields: Record<string, unknown>): Promise<boolean> {
  const response = (await blocksClient.data.collection("ReturnCase").update(itemId, fields)) as UpdateReturnCaseResponse;
  return !mutationFailed(response, response?.data?.updateReturnCase);
}
