import { useCallback, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { notifyRole } from "../../lib/blocks/notify";

// Confirmed live via `blocks storage config list --project Df53833214f2a4243b696b55040b32509
// --account default --json`: this project has exactly one storage configuration and its
// name is "Default" (capital D) -- the README/plan example's "default" does not exist here.
const STORAGE_CONFIGURATION_NAME = "Default";

type PresignedUploadResponse = {
  uploadUrl?: string;
  fileId?: string;
  isSuccess?: boolean;
  errors?: unknown;
};

type UploadOutcome = { fileIds: string[]; failures: string[] };

// Uploads every selected photo, one at a time, and never lets one failure
// take the others down with it. A file that fails is recorded in `failures`
// and simply excluded from `fileIds` -- the caller ships the return with
// whichever photos actually made it up, rather than faking success or
// blocking the whole submission on a flaky/broken upload path.
async function uploadPhotos(files: File[]): Promise<UploadOutcome> {
  const fileIds: string[] = [];
  const failures: string[] = [];

  for (const file of files) {
    try {
      const upload = (await blocksClient.data.files.presignedUploadUrl({
        name: file.name,
        configurationName: STORAGE_CONFIGURATION_NAME,
        parentDirectoryId: "root",
        accessModifier: "Private"
      })) as PresignedUploadResponse;

      // This endpoint can answer 200 with isSuccess:false and empty
      // uploadUrl/fileId (observed live: {"uploadUrl":"","fileId":"",
      // "errors":{"access":"forbidden"},"isSuccess":false}) rather than
      // throwing -- so a falsy field is treated as failure even when the
      // call itself didn't throw.
      if (upload.isSuccess === false || !upload.uploadUrl || !upload.fileId) {
        const detail = upload.errors ? ` (${JSON.stringify(upload.errors)})` : "";
        throw new Error(`storage did not return an upload URL for "${file.name}"${detail}`);
      }

      await blocksClient.data.files.uploadToUrl({
        url: upload.uploadUrl,
        body: file,
        contentType: file.type
      });

      fileIds.push(upload.fileId);
    } catch (caught) {
      failures.push(`${file.name}: ${(caught as Error).message}`);
    }
  }

  return { fileIds, failures };
}

// The order the customer picked from the eligible-orders dropdown
// (useEligibleOrders.ts) -- its fields are carried straight onto the new
// ReturnCase, exactly as the old free-text lookup used to copy them from
// the Order row it matched.
export type SubmitReturnInput = {
  orderNumber: string;
  sku?: string;
  productName?: string;
  unitPrice?: number;
  area?: string;
  courier?: string;
  rawCustomerText: string;
  photos: File[];
};

export type SubmitReturnResult = {
  itemId: string;
  photoFailures: string[];
};

type GraphQLError = { message?: string; extensions?: { code?: string; validationErrors?: string[] } };

type CreateReturnCaseResponse = {
  data?: { insertReturnCase?: { acknowledged?: boolean; itemId?: string } | null };
  errors?: GraphQLError[];
};

// `ReturnCase.orderNumber` is `isUniqueData: true` and enforced server-side,
// but a violation does NOT throw and is NOT a non-2xx response -- it comes
// back HTTP 200 with a GraphQL `errors` array (code VALIDATION_ERROR,
// validationType Unique on the orderNumber field) and
// `data.insertReturnCase: null`. This distinguishes that specific rejection
// from any other create failure so the UI can show a precise message
// instead of a raw server string.
function isDuplicateOrderError(errors: GraphQLError[]): boolean {
  return errors.some((graphQLError) => {
    const message = graphQLError?.message ?? "";
    const validationErrors = graphQLError?.extensions?.validationErrors ?? [];
    return (
      (message.includes("orderNumber") && /already exists/i.test(message)) ||
      validationErrors.some((entry) => entry.includes("orderNumber"))
    );
  });
}

export function useSubmitReturn() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const submit = useCallback(async (input: SubmitReturnInput): Promise<SubmitReturnResult | undefined> => {
    setSubmitting(true);
    setError(undefined);
    try {
      // The read policy keys on the server-set CreatedBy, not on this field --
      // see the security note in NewReturnPage.tsx. customerItemId is still set
      // because child-row policies and ops tooling key on it, and the two must
      // agree. No client-side ownership check is added; it would protect nothing.
      const me = await blocksClient.iam.me();
      const customerItemId = me?.data?.itemId;
      if (!customerItemId) {
        setError("no-session");
        return undefined;
      }

      const { fileIds: photoFileIds, failures: photoFailures } =
        input.photos.length > 0 ? await uploadPhotos(input.photos) : { fileIds: [], failures: [] };

      const payload: Record<string, unknown> = {
        customerItemId,
        orderNumber: input.orderNumber,
        sku: input.sku,
        productName: input.productName,
        unitPrice: input.unitPrice,
        area: input.area,
        courier: input.courier,
        rawCustomerText: input.rawCustomerText,
        // Exactly "SUBMITTED". Every ai* and confirmed* field is left unset --
        // those belong to the agent and to ops respectively.
        status: "SUBMITTED"
      };
      if (photoFileIds.length > 0) payload.photoFileIds = photoFileIds;

      const createResponse = (await blocksClient.data
        .collection("ReturnCase")
        .create(payload)) as CreateReturnCaseResponse;

      // Check for a GraphQL `errors` array BEFORE looking at `data` -- a 200
      // response can carry both a populated `errors` array and a null
      // `data.insertReturnCase` at once, and only the errors array says why.
      if (Array.isArray(createResponse?.errors) && createResponse.errors.length > 0) {
        setError(isDuplicateOrderError(createResponse.errors) ? "duplicate-order" : "create-failed");
        return undefined;
      }

      const inserted = createResponse?.data?.insertReturnCase;
      if (!inserted?.itemId || inserted.acknowledged === false) {
        setError("create-failed");
        return undefined;
      }

      // The return exists now; tell ops. Fire-and-forget: a failed ping must
      // never turn a successful submission into an error for the customer.
      void notifyRole("ops", "RETURN_SUBMITTED", {
        returnId: inserted.itemId,
        orderNumber: input.orderNumber,
        productName: input.productName ?? ""
      });

      return { itemId: inserted.itemId, photoFailures };
    } catch (caught) {
      setError((caught as Error).message);
      return undefined;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting, error };
}
