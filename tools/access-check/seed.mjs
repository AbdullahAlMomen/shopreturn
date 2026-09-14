// Seeds the fixture data the access-control assertions (Task 3) will run
// against: one Order, one ReturnCase owned by customer A, one ReturnTimeline
// row and one Inspection row for that return.
//
// Signs in as ops (schemas are currently Public/access-level 2 with no data
// policies deployed, so any signed-in user could write these rows today --
// ops is used because it is the role that would own this data once Task 4
// deploys the real policies).
//
// Step 1 of the task-2 brief probed blocks.data.collection() with three
// name forms against ReturnCase: the schema name ("ReturnCase"), and the two
// plausible collection-name forms ("blx_ReturnCases", "ReturnCases"). Only
// the schema name worked -- the SDK builds GraphQL operation names
// (getReturnCases / insertReturnCase / ...) from whatever string is passed,
// so it must be the schema name, not the Mongo collection name. See
// tools/access-check/task-2-report.md for the exact errors from the other
// two forms.
import { writeFile } from "node:fs/promises";
import { signIn } from "./client.mjs";

const CUSTOMER_A_ITEM_ID = "28412829-9537-46e0-89b0-e458d46a375d";

function fail(label, response) {
  throw new Error(`${label} failed: ${JSON.stringify(response)}`);
}

// A 200 response can still carry failure in two different shapes depending
// on the endpoint: a GraphQL `errors` array, or an `isSuccess: false` flag.
// Neither raises an HTTP error, so both must be checked explicitly.
function assertOk(label, response) {
  if (response && Array.isArray(response.errors) && response.errors.length > 0) {
    fail(label, response);
  }
  if (response && response.isSuccess === false) {
    fail(label, response);
  }
  return response;
}

function extractItemId(label, response, mutationField) {
  const result = response?.data?.[mutationField];
  if (!result || !result.itemId) {
    fail(label, response);
  }
  if (result.acknowledged === false) {
    fail(label, response);
  }
  return result.itemId;
}

async function main() {
  const { blocks } = await signIn(process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD);

  const orderResponse = assertOk(
    "insertOrder",
    await blocks.data.collection("Order").create({
      orderNumber: "10-4821",
      sku: "SH-022",
      productName: "Canvas Sneaker",
      unitPrice: 1450,
      area: "Mirpur 11",
      courier: "Sundarban Courier",
      customerEmail: process.env.SHOPRETURN_CUSTOMER_A_EMAIL
    })
  );
  const orderItemId = extractItemId("insertOrder", orderResponse, "insertOrder");

  const returnCaseResponse = assertOk(
    "insertReturnCase",
    await blocks.data.collection("ReturnCase").create({
      customerItemId: CUSTOMER_A_ITEM_ID,
      orderNumber: "10-4821",
      sku: "SH-022",
      status: "SUBMITTED",
      rawCustomerText: "order #10-4821 er shoe ta box chire geche, ekta shoe er sole alada hoye geche.",
      aiReason: "DAMAGED_IN_TRANSIT",
      aiConfidence: 0.86,
      aiRestockable: false,
      aiCourierClaim: true,
      aiDraftMessage: "We've received your return request and will inspect the item."
      // confirmedReason deliberately left unset -- see file header / brief.
    })
  );
  const returnCaseItemId = extractItemId("insertReturnCase", returnCaseResponse, "insertReturnCase");

  const timelineResponse = assertOk(
    "insertReturnTimeline",
    await blocks.data.collection("ReturnTimeline").create({
      returnId: returnCaseItemId,
      customerItemId: CUSTOMER_A_ITEM_ID,
      status: "SUBMITTED",
      message: "Return request received.",
      isCustomerVisible: true
    })
  );
  const timelineItemId = extractItemId("insertReturnTimeline", timelineResponse, "insertReturnTimeline");

  const inspectionResponse = assertOk(
    "insertInspection",
    await blocks.data.collection("Inspection").create({
      returnId: returnCaseItemId,
      customerItemId: CUSTOMER_A_ITEM_ID,
      conditionOnArrival: "MAJOR_DAMAGE",
      restockable: false,
      faultAttribution: "COURIER",
      inspectorNotes: "Sole detached in transit; box crushed."
    })
  );
  const inspectionItemId = extractItemId("insertInspection", inspectionResponse, "insertInspection");

  const fixtureIds = {
    orderItemId,
    returnCaseItemId,
    timelineItemId,
    inspectionItemId,
    customerAItemId: CUSTOMER_A_ITEM_ID
  };

  await writeFile(
    new URL("./fixture-ids.json", import.meta.url),
    JSON.stringify(fixtureIds, null, 2) + "\n"
  );

  console.log(JSON.stringify(fixtureIds, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
