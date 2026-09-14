import { useCallback, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";

// Confirmed live via `blocks storage config list --project Df53833214f2a4243b696b55040b32509
// --account default --json`: this project has exactly one storage configuration and its
// name is "Default" (capital D) -- the README/plan example's "default" does not exist here.
const STORAGE_CONFIGURATION_NAME = "Default";

type OrderMatch = {
  orderNumber?: string;
  sku?: string;
  productName?: string;
  unitPrice?: number;
  area?: string;
  courier?: string;
};

// Everything ops and the fixture need to render a real product line (Task 1
// found the fixture had `sku` but not the rest, and the row rendered
// "Unknown product") -- copied from the matched Order onto the new ReturnCase.
const ORDER_FIELDS = ["orderNumber", "sku", "productName", "unitPrice", "area", "courier"];

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

export type SubmitReturnInput = {
  orderNumber: string;
  rawCustomerText: string;
  photos: File[];
};

export type SubmitReturnResult = {
  itemId: string;
  photoFailures: string[];
};

export function useSubmitReturn() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const submit = useCallback(async (input: SubmitReturnInput): Promise<SubmitReturnResult | undefined> => {
    setSubmitting(true);
    setError(undefined);
    try {
      const orderNumber = input.orderNumber.trim();

      const orderResponse = (await blocksClient.data
        .collection("Order", { fields: ORDER_FIELDS })
        .list({ filter: { orderNumber }, pageNo: 1, pageSize: 1 })) as {
          data?: { getOrders?: { items?: OrderMatch[] } };
        };
      const order = orderResponse?.data?.getOrders?.items?.[0];
      if (!order) {
        setError(`no-order:${orderNumber}`);
        return undefined;
      }

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
        orderNumber: order.orderNumber ?? orderNumber,
        sku: order.sku,
        productName: order.productName,
        unitPrice: order.unitPrice,
        area: order.area,
        courier: order.courier,
        rawCustomerText: input.rawCustomerText,
        // Exactly "SUBMITTED". Every ai* and confirmed* field is left unset --
        // those belong to the agent and to ops respectively.
        status: "SUBMITTED"
      };
      if (photoFileIds.length > 0) payload.photoFileIds = photoFileIds;

      const createResponse = (await blocksClient.data.collection("ReturnCase").create(payload)) as {
        data?: { insertReturnCase?: { acknowledged?: boolean; itemId?: string } };
      };
      const inserted = createResponse?.data?.insertReturnCase;
      if (!inserted?.itemId || inserted.acknowledged === false) {
        setError("create-failed");
        return undefined;
      }

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
