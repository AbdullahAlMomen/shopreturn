// Six access-control assertions proving (or, right now, disproving) the
// ShopReturn access boundary.
//
// At this commit no data access policies are deployed and all seven schemas
// sit at access level 2 (Public). There is nothing enforcing the boundary
// yet, so assertions 1, 3, 4, 5 and 6 are EXPECTED to FAIL here -- that is
// the "before" half of the proof this task exists to produce. Assertion 2
// is the control (a same-owner read) and is expected to pass; if it fails
// the boundary is already too tight, which is reported loudly rather than
// folded in with the others.
//
// A later task deploys the real policies and is expected to turn this exact
// suite green with no changes to the assertions themselves.
//
// "Denied" has two shapes and both count as a pass here:
//   - a thrown error (schema-level denial, typically a non-2xx response or
//     a GraphQL `errors` entry) -- printed as `denied(threw: <message>)`
//   - a call that returns HTTP 200 but an empty result set (row-level
//     filtering) -- printed as `denied(empty)`
// Which shape occurred is the primary diagnostic for the next task, so it
// is always printed, never collapsed into a bare PASS/FAIL.

import { readFile } from "node:fs/promises";
import { signIn } from "./client.mjs";

const fixtureIds = JSON.parse(
  await readFile(new URL("./fixture-ids.json", import.meta.url), "utf8")
);
const { returnCaseItemId, timelineItemId } = fixtureIds;

const SEEDED_AI_REASON = "DAMAGED_IN_TRANSIT"; // set by seed.mjs; see file header there.

const results = [];

function record(n, label, pass, reason) {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} #${n} ${label} -- ${reason}`);
}

// Runs one SDK call and classifies the result into exactly the shapes a
// caller needs to decide allowed-vs-denied:
//   { outcome: "threw", message }        -- non-2xx, or the SDK itself threw
//   { outcome: "graphql-error", message } -- 200 response, but a GraphQL
//                                            `errors` array or `isSuccess:
//                                            false` flag says the operation
//                                            did not go through
//   { outcome: "ok", response }          -- 200, no error signal; caller
//                                            still has to check for an empty
//                                            result set (row-level filtering)
async function attempt(fn) {
  try {
    const response = await fn();
    if (response && Array.isArray(response.errors) && response.errors.length > 0) {
      return { outcome: "graphql-error", message: summarizeErrors(response.errors) };
    }
    if (response && response.isSuccess === false) {
      return { outcome: "graphql-error", message: response.message ?? "isSuccess: false" };
    }
    return { outcome: "ok", response };
  } catch (error) {
    return { outcome: "threw", message: error.message };
  }
}

function summarizeErrors(errors) {
  return errors.map((error) => error?.message ?? JSON.stringify(error)).join("; ");
}

function itemsOf(response, listField) {
  return response?.data?.[listField]?.items ?? [];
}

// Shared "denied or empty" classifier for the four assertions (1, 4, 5) that
// pass on either shape of denial, or fail with the returned rows when the
// call actually succeeded. Assertions 2, 3 and 6 have their own bespoke
// handling below because a plain allow/deny split isn't what they check.
function classifyDeniedOrEmpty(n, label, result, listField) {
  if (result.outcome === "threw" || result.outcome === "graphql-error") {
    record(n, label, true, `denied(threw: ${result.message})`);
    return;
  }
  const items = itemsOf(result.response, listField);
  if (items.length === 0) {
    record(n, label, true, "denied(empty)");
  } else {
    record(n, label, false, `allowed -- returned ${items.length} row(s): ${JSON.stringify(items)}`);
  }
}

async function main() {
  const { blocks: blocksA } = await signIn(
    process.env.SHOPRETURN_CUSTOMER_A_EMAIL,
    process.env.SHOPRETURN_CUSTOMER_A_PASSWORD
  );
  const { blocks: blocksB } = await signIn(
    process.env.SHOPRETURN_CUSTOMER_B_EMAIL,
    process.env.SHOPRETURN_CUSTOMER_B_PASSWORD
  );
  const { blocks: blocksOps } = await signIn(
    process.env.SHOPRETURN_OPS_EMAIL,
    process.env.SHOPRETURN_OPS_PASSWORD
  );

  // 1. Customer B reads customer A's ReturnCase by returnCaseItemId.
  // Passes on denied(threw) or denied(empty); fails if B can see A's row.
  {
    const result = await attempt(() => blocksB.data.collection("ReturnCase").get(returnCaseItemId));
    classifyDeniedOrEmpty(1, "customerB reads customerA's ReturnCase", result, "getReturnCases");
  }

  // 2. CONTROL. Customer A reads their own ReturnCase. Must succeed --
  // if this fails, the boundary is too tight, not too loose, and that is
  // reported distinctly rather than folded into the pass/fail count logic
  // used for the other five.
  {
    const result = await attempt(() => blocksA.data.collection("ReturnCase").get(returnCaseItemId));
    if (result.outcome !== "ok") {
      record(
        2,
        "[CONTROL] customerA reads their own ReturnCase",
        false,
        `BOUNDARY TOO TIGHT -- expected success but got denied(${result.outcome}: ${result.message})`
      );
    } else {
      const items = itemsOf(result.response, "getReturnCases");
      if (items.length > 0) {
        const itemId = items[0]?.ItemId ?? items[0]?.itemId;
        record(2, "[CONTROL] customerA reads their own ReturnCase", true, `allowed -- returned row (itemId=${itemId})`);
      } else {
        record(
          2,
          "[CONTROL] customerA reads their own ReturnCase",
          false,
          "BOUNDARY TOO TIGHT -- expected success but got an empty result for the owner's own row"
        );
      }
    }
  }

  // 3. Customer A reads aiReason on their own ReturnCase. Passes when the
  // field is absent/null (withheld) or present but not the seeded plaintext
  // (masked). Fails when the exact seeded value comes back unmasked.
  {
    const result = await attempt(() =>
      blocksA.data.collection("ReturnCase").get(returnCaseItemId, { fields: ["aiReason"] })
    );
    if (result.outcome === "threw" || result.outcome === "graphql-error") {
      record(3, "customerA reads aiReason on their own ReturnCase", true, `denied(threw: ${result.message})`);
    } else {
      const items = itemsOf(result.response, "getReturnCases");
      if (items.length === 0) {
        record(3, "customerA reads aiReason on their own ReturnCase", true, "denied(empty)");
      } else {
        const value = items[0]?.aiReason;
        if (value === undefined || value === null) {
          record(3, "customerA reads aiReason on their own ReturnCase", true, "absent/null -- field withheld");
        } else if (value === SEEDED_AI_REASON) {
          record(
            3,
            "customerA reads aiReason on their own ReturnCase",
            false,
            `allowed -- full plaintext value returned: ${JSON.stringify(value)}`
          );
        } else {
          record(
            3,
            "customerA reads aiReason on their own ReturnCase",
            true,
            `masked -- value differs from the seeded plaintext: ${JSON.stringify(value)}`
          );
        }
      }
    }
  }

  // 4. Customer A lists Inspection. One Inspection row is seeded (for this
  // customer's own return), so this exercises a real non-empty collection --
  // it does not depend on the collection being empty to pass.
  {
    const result = await attempt(() => blocksA.data.collection("Inspection").list());
    classifyDeniedOrEmpty(4, "customerA lists Inspection", result, "getInspections");
  }

  // 5. Customer A lists PatternAlert. NOTE: no PatternAlert rows exist
  // anywhere in this tenant (seed.mjs never creates one), so denied(empty)
  // here is ambiguous -- it may reflect enforcement, or it may simply be an
  // empty collection with nothing to filter. See the task report for the
  // caveat this prints.
  {
    const result = await attempt(() => blocksA.data.collection("PatternAlert").list());
    if (result.outcome === "threw" || result.outcome === "graphql-error") {
      record(5, "customerA lists PatternAlert", true, `denied(threw: ${result.message})`);
    } else {
      const items = itemsOf(result.response, "getPatternAlerts");
      if (items.length === 0) {
        record(
          5,
          "customerA lists PatternAlert",
          true,
          "denied(empty) -- CAVEAT: no PatternAlert rows are seeded in this tenant, so this empty result cannot by itself distinguish enforcement from an empty collection"
        );
      } else {
        record(5, "customerA lists PatternAlert", false, `allowed -- returned ${items.length} row(s): ${JSON.stringify(items)}`);
      }
    }
  }

  // 6. Ops updates the seeded ReturnTimeline row. Passes only on a thrown
  // denial or an acknowledged-false / zero-impact response; fails if the
  // write actually goes through.
  {
    const result = await attempt(() =>
      blocksOps.data.collection("ReturnTimeline").update(timelineItemId, {
        message: "access-check probe update -- should be denied once policies are deployed"
      })
    );
    if (result.outcome === "threw" || result.outcome === "graphql-error") {
      record(6, "ops updates the seeded ReturnTimeline row", true, `denied(threw: ${result.message})`);
    } else {
      const payload = result.response?.data?.updateReturnTimeline;
      const acknowledged = payload?.acknowledged;
      const impacted = payload?.totalImpactedData;
      if (acknowledged === false || impacted === 0) {
        record(
          6,
          "ops updates the seeded ReturnTimeline row",
          true,
          `denied(empty) -- acknowledged=${acknowledged} totalImpactedData=${impacted}`
        );
      } else {
        record(
          6,
          "ops updates the seeded ReturnTimeline row",
          false,
          `allowed -- update succeeded (acknowledged=${acknowledged}, totalImpactedData=${impacted})`
        );
      }
    }
  }

  const passing = results.filter(Boolean).length;
  console.log(`${passing}/6 passing`);
  process.exit(passing === 6 ? 0 : 1);
}

main().catch((error) => {
  console.error(`Suite crashed: ${error.message}`);
  process.exit(1);
});
