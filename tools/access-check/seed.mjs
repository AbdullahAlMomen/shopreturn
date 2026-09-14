// Seeds the fixture data the access-control assertions (Task 3) will run
// against: one Order, one ReturnCase owned by customer A, one ReturnTimeline
// row and one Inspection row for that return, plus one PatternAlert and one
// Decision so assertion 5 ("customer A cannot list PatternAlert") has a real
// row to be denied instead of passing vacuously against an empty collection.
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
//
// The script is idempotent: it reads any existing fixture-ids.json first and
// reuses ids already recorded there instead of re-creating those rows. This
// matters because the six rows are seeded in two passes (four rows in the
// original task, two more -- PatternAlert and Decision -- added afterward);
// rerunning the whole script must not duplicate the first four.
import { readFile, writeFile } from "node:fs/promises";
import { signIn } from "./client.mjs";

const FIXTURE_IDS_URL = new URL("./fixture-ids.json", import.meta.url);

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

async function loadExistingFixtureIds() {
  try {
    const text = await readFile(FIXTURE_IDS_URL, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function main() {
  const existing = await loadExistingFixtureIds();
  const { blocks } = await signIn(process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD);

  let orderItemId = existing.orderItemId;
  if (!orderItemId) {
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
    orderItemId = extractItemId("insertOrder", orderResponse, "insertOrder");
  }

  let returnCaseItemId = existing.returnCaseItemId;
  if (!returnCaseItemId) {
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
    returnCaseItemId = extractItemId("insertReturnCase", returnCaseResponse, "insertReturnCase");
  }

  let timelineItemId = existing.timelineItemId;
  if (!timelineItemId) {
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
    timelineItemId = extractItemId("insertReturnTimeline", timelineResponse, "insertReturnTimeline");
  }

  let inspectionItemId = existing.inspectionItemId;
  if (!inspectionItemId) {
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
    inspectionItemId = extractItemId("insertInspection", inspectionResponse, "insertInspection");
  }

  // PatternAlert -- the SKU pattern from the product spec's demo script.
  // Exists so assertion 5 ("customer A cannot list PatternAlert") is denying
  // a real row instead of passing vacuously against an empty collection.
  let patternAlertItemId = existing.patternAlertItemId;
  if (!patternAlertItemId) {
    const patternAlertResponse = assertOk(
      "insertPatternAlert",
      await blocks.data.collection("PatternAlert").create({
        dimension: "SKU",
        value: "SH-022",
        metric: 38,
        threshold: 30,
        takaImpact: 44950,
        contributingReturnIds: [returnCaseItemId],
        draftExplanation:
          "24 of 31 SH-022 returns are Mirpur via one courier, mostly damaged in transit. This looks like a courier handling problem rather than sizing.",
        raisedAt: new Date().toISOString()
        // acknowledgedBy deliberately left unset -- see coordinator follow-up.
      })
    );
    patternAlertItemId = extractItemId("insertPatternAlert", patternAlertResponse, "insertPatternAlert");
  }

  // Decision -- one of the three follow-ups the spec names for this alert.
  let decisionItemId = existing.decisionItemId;
  if (!decisionItemId) {
    const decisionResponse = assertOk(
      "insertDecision",
      await blocks.data.collection("Decision").create({
        alertId: patternAlertItemId,
        decisionType: "COURIER_CLAIM",
        target: "Sundarban Courier",
        note: "File a claim for the 24 damaged SH-022 parcels.",
        decidedAt: new Date().toISOString(),
        status: "OPEN"
        // decidedBy deliberately left unset -- see coordinator follow-up.
      })
    );
    decisionItemId = extractItemId("insertDecision", decisionResponse, "insertDecision");
  }

  const fixtureIds = {
    orderItemId,
    returnCaseItemId,
    timelineItemId,
    inspectionItemId,
    customerAItemId: CUSTOMER_A_ITEM_ID,
    patternAlertItemId,
    decisionItemId
  };

  await writeFile(FIXTURE_IDS_URL, JSON.stringify(fixtureIds, null, 2) + "\n");

  console.log(JSON.stringify(fixtureIds, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
