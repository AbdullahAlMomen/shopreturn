// Nine access-control assertions proving (or, right now, disproving) the
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
// Assertions 1-6 cover the READ side and are green against the deployed
// policy set. Assertion 7 was appended later to probe the WRITE side: it
// asks whether a row-field rule is evaluated against an inbound row on
// insert, which `blocks/data/ACCESS-NOTES.md` §10 records as unverified.
// It is expected to FAIL until `customer-creates-returns` carries an
// ownership rule -- that failure is the evidence the hole is real.
//
// Assertion 9 is the one that matters for the product. Assertion 7 asks
// whether the forged write can be BLOCKED (it cannot). Assertion 9 asks
// whether it can do any HARM -- whether the forged row reaches the customer
// it names. Both are kept: 7 stays red on purpose so nobody later assumes
// inserts are validated.
//
// Assertion 8 was appended alongside the `ops` delete grants on `ReturnCase`,
// `Inspection` and `Refund`. Assertion 6 shows `ops` cannot UPDATE a
// `ReturnTimeline` row; granting `ops` delete anywhere makes "can `ops`
// DELETE one?" a reachable question, and append-only is the spec's core trust
// guarantee. It runs last because a regression there destroys a fixture.
//
// Assertions 10-11 were appended once `Order` rows became owned and
// `ReturnCase.orderNumber` became unique. Assertion 10 is the read-side
// twin of assertion 1, but for `Order`: customer A has three orders and
// customer B has one, so a leak is directly observable, not vacuous.
// Assertion 11 is the write-side guarantee that an order can only ever
// carry one return -- it must detect the rejection correctly, because the
// server returns HTTP 200 with a GraphQL `errors` array and
// `data.insertReturnCase: null` rather than throwing.
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
// Added for assertion 7: the owner customer B will try to forge onto a row.
const { customerAItemId } = fixtureIds;

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

// Cleanup for assertion 7. If the forged row is actually created the probe
// has left debris in the fixture set, which would corrupt every later run of
// this suite, so it is removed immediately.
//
// It deletes as **ops**, never as customer B. The first version of this helper
// tried customer B first; the policy set grants no customer any delete, so it
// was denied every time and forged rows accumulated, one per failing run.
// `ops-deletes-returns` is the grant that actually works. With the ownership
// rule on `customer-creates-returns` deployed this path should never be
// reached at all -- it exists so that the day it is, it works.
async function deleteForgedReturnCase(itemId, clients) {
  const notes = [];
  for (const [who, blocks] of clients) {
    const result = await attempt(() => blocks.data.collection("ReturnCase").delete(itemId, { hardDelete: true }));
    if (result.outcome === "threw" || result.outcome === "graphql-error") {
      notes.push(`delete as ${who} denied(threw: ${result.message})`);
      continue;
    }
    const payload = result.response?.data?.deleteReturnCase;
    const acknowledged = payload?.acknowledged;
    const impacted = payload?.totalImpactedData;
    if (acknowledged === false || impacted === 0) {
      notes.push(`delete as ${who} denied(empty) -- acknowledged=${acknowledged} totalImpactedData=${impacted}`);
      continue;
    }
    notes.push(`DELETED as ${who} (acknowledged=${acknowledged}, totalImpactedData=${impacted})`);
    return { deleted: true, notes };
  }
  return { deleted: false, notes };
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

  // 7. Customer B creates a ReturnCase naming customer A as its owner
  // (`customerItemId` = customerAItemId). This is the write-side twin of
  // assertion 1: assertion 1 proves B cannot READ A's row, this one asks
  // whether B can MANUFACTURE a row that belongs to A. The deployed
  // `customer-creates-returns` policy checks only the caller's role, so
  // this is expected to be allowed -- i.e. to FAIL -- until a row-field
  // rule on `customerItemId` is added and proven to be evaluated on insert.
  //
  // Passes on either denial shape; fails if the row is created. On failure
  // the forged row is deleted immediately (see deleteForgedReturnCase) and
  // the outcome of that cleanup is printed with the FAIL line.
  {
    const result = await attempt(() =>
      blocksB.data.collection("ReturnCase").create({
        customerItemId: customerAItemId,
        orderNumber: "10-9999",
        sku: "SH-022",
        status: "SUBMITTED",
        rawCustomerText: "forgery probe"
      })
    );
    const label = "customerB creates a ReturnCase owned by customerA";
    if (result.outcome === "threw" || result.outcome === "graphql-error") {
      record(7, label, true, `denied(threw: ${result.message})`);
    } else {
      const payload = result.response?.data?.insertReturnCase;
      const itemId = payload?.itemId;
      const acknowledged = payload?.acknowledged;
      if (!itemId || acknowledged === false) {
        record(
          7,
          label,
          true,
          `denied(empty) -- acknowledged=${acknowledged} itemId=${itemId}`
        );
      } else {
        // Deleted as ops, never as customer B: no customer holds a delete
        // grant, so the old customer-B-first attempt could only ever fail and
        // leave the forged row behind. See deleteForgedReturnCase.
        const cleanup = await deleteForgedReturnCase(itemId, [["ops", blocksOps]]);
        record(
          7,
          label,
          false,
          `allowed -- forged row created (itemId=${itemId}); cleanup: ${
            cleanup.deleted ? "row removed" : "ROW STILL PRESENT -- remove it by hand"
          } [${cleanup.notes.join(" | ")}]`
        );
      }
    }
  }

  // 8. Ops deletes the seeded ReturnTimeline row. Must be DENIED.
  //
  // ReturnTimeline is append-only by design -- "a permanent, visible log of
  // exactly what the customer was told". A correction is a new entry, never a
  // removal. Assertion 6 covers the update half of that; this covers delete,
  // which became a live risk the moment `ops` was granted delete on
  // ReturnCase, Inspection and Refund. The guarantee is enforced by the
  // ABSENCE of a delete policy on this schema (ACCESS-NOTES.md §9), so the
  // expected shape is a 401, not a row filter.
  //
  // Deliberately last in the file: if it ever wrongly passes through, it
  // destroys the timeline fixture every later run depends on. The read-back
  // below fails the assertion if the row is gone even when the delete call
  // itself looked denied.
  {
    const label = "ops deletes the seeded ReturnTimeline row";
    const result = await attempt(() =>
      blocksOps.data.collection("ReturnTimeline").delete(timelineItemId)
    );

    let denied;
    let detail;
    if (result.outcome === "threw" || result.outcome === "graphql-error") {
      denied = true;
      detail = `denied(threw: ${result.message})`;
    } else {
      const payload = result.response?.data?.deleteReturnTimeline;
      const acknowledged = payload?.acknowledged;
      const impacted = payload?.totalImpactedData;
      if (acknowledged === false || impacted === 0) {
        denied = true;
        detail = `denied(empty) -- acknowledged=${acknowledged} totalImpactedData=${impacted}`;
      } else {
        denied = false;
        detail = `allowed -- delete succeeded (acknowledged=${acknowledged}, totalImpactedData=${impacted})`;
      }
    }

    // Confirm the fixture survived, whatever the delete call claimed. A
    // denial that still removed the row would be the worst possible outcome
    // and must not be recorded as a pass.
    const readBack = await attempt(() =>
      blocksOps.data.collection("ReturnTimeline").get(timelineItemId, { fields: ["ItemId"] })
    );
    const stillThere =
      readBack.outcome === "ok" && itemsOf(readBack.response, "getReturnTimelines").length > 0;

    if (denied && stillThere) {
      record(8, label, true, `${detail}; fixture row still present`);
    } else if (denied && !stillThere) {
      record(
        8,
        label,
        false,
        `${detail} BUT THE FIXTURE ROW IS GONE -- reseed before trusting any later run`
      );
    } else {
      record(8, label, false, `${detail} -- APPEND-ONLY GUARANTEE BROKEN; the timeline fixture was destroyed`);
    }
  }

  // 9. THE ONE THAT MATTERS. Customer B forges a ReturnCase naming customer A
  // as owner (assertion 7 shows this insert cannot be blocked), and customer A
  // must NOT see it.
  //
  // This works because `customer-reads-own-returns` keys on `CreatedBy`, which
  // the server stamps from the auth context at insert time and which is not
  // even a field on `ReturnCaseInsertInput` -- a client cannot set it. The
  // forged row therefore carries customer B's id, and the read-side rule keeps
  // it away from customer A. The write hole is real but inert.
  //
  // Passes when A cannot see the forged row; fails when A can. The forged row
  // is deleted as ops afterwards either way, and A's list is re-checked --
  // but "re-checked" means a SET comparison against a snapshot taken before
  // the probe ran, not a hard-coded fixture shape. Customer A legitimately
  // accumulates more ReturnCase rows over time (the ops console's Task 1
  // seeded a second one, on order 10-4822, deliberately left awaiting
  // review), so "customer A owns exactly one row, and it is THE fixture" is
  // not a stable definition of "the probe left nothing behind" -- it breaks
  // every time the project legitimately grows a return. "The set of ids
  // customer A can see is identical before and after" is the actual claim
  // this assertion needs, and it stays true regardless of how many real
  // rows customer A owns.
  {
    const label = "[HARM] customerB's forged ReturnCase is invisible to customerA";

    const before = await attempt(() =>
      blocksA.data.collection("ReturnCase").list({ fields: ["ItemId"] })
    );
    const beforeIds = new Set(itemsOf(before.response, "getReturnCases").map((r) => r?.ItemId ?? r?.itemId));

    const forge = await attempt(() =>
      blocksB.data.collection("ReturnCase").create({
        customerItemId: customerAItemId,
        orderNumber: "10-9996",
        sku: "SH-022",
        status: "SUBMITTED",
        rawCustomerText: "harm probe -- customerB forging a row onto customerA"
      })
    );

    const forgedId = forge.outcome === "ok" ? forge.response?.data?.insertReturnCase?.itemId : undefined;

    if (!forgedId) {
      // The insert was blocked. Nothing was forged, so there is nothing for A
      // to see and this assertion proves nothing on its own -- say so rather
      // than banking a vacuous pass.
      record(
        9,
        label,
        true,
        "vacuous -- the forging insert was itself denied, so no forged row existed to hide (this means assertion 7 now passes; re-read both together)"
      );
    } else {
      const aView = await attempt(() =>
        blocksA.data.collection("ReturnCase").list({ fields: ["ItemId"] })
      );
      const visibleIds = itemsOf(aView.response, "getReturnCases").map((r) => r?.ItemId ?? r?.itemId);
      const leaked = visibleIds.includes(forgedId);

      // Clean up before recording, so a failure still leaves the fixtures sane.
      const cleanup = await deleteForgedReturnCase(forgedId, [["ops", blocksOps]]);
      const after = await attempt(() =>
        blocksA.data.collection("ReturnCase").list({ fields: ["ItemId"] })
      );
      const afterIds = new Set(itemsOf(after.response, "getReturnCases").map((r) => r?.ItemId ?? r?.itemId));

      // A diff is diagnosable; a raw dump is not -- report exactly what the
      // probe added or lost relative to the pre-probe snapshot.
      const added = [...afterIds].filter((id) => !beforeIds.has(id));
      const missing = [...beforeIds].filter((id) => !afterIds.has(id));
      const restored = added.length === 0 && missing.length === 0;

      if (leaked) {
        record(
          9,
          label,
          false,
          `LEAKED -- customerA can see the forged row (${forgedId}); customerA saw [${visibleIds.join(", ")}]; cleanup: ${cleanup.notes.join(" | ")}`
        );
      } else if (!restored) {
        record(
          9,
          label,
          false,
          `hidden from customerA, BUT the probe left customerA's ReturnCase set changed -- added:[${added.join(", ")}] missing:[${missing.join(", ")}]; cleanup: ${cleanup.notes.join(" | ")}`
        );
      } else {
        record(
          9,
          label,
          true,
          `hidden -- forged row ${forgedId} created but invisible to customerA (CreatedBy is the forger); customerA's visible ReturnCase set is unchanged from before the probe; cleanup: ${cleanup.notes.join(" | ")}`
        );
      }
    }
  }

  // 10. Customer B cannot see customer A's orders. `Order` reads are now
  // split into `customer-reads-own-orders` (role customer AND
  // customerItemId == UserId) and `staff-reads-all-orders` (ops/manager,
  // unscoped). Customer A has three orders (10-4821, 10-4822, 10-4823);
  // customer B has at least one (10-5001) -- non-vacuous because A's three
  // demonstrably exist. This isn't a plain "denied or empty" check like 1,
  // 4 and 5: customer B is SUPPOSED to see their own order, so the pass
  // condition is "sees their own, and none of A's", not "sees nothing".
  //
  // Originally written as `orderNumbers.length === 1 && orderNumbers[0] ===
  // "10-5001"` -- correct only because customer B happened to own exactly
  // one order. That's a fixture-shape assumption smuggled into a scoping
  // check: the day customer B legitimately gets a second order, this would
  // fail, and it would fail looking like a SCOPING bug (leak) when nothing
  // had leaked. The property that actually matters is set-based and doesn't
  // care how many orders either customer owns: none of customer A's known
  // order numbers may appear in customer B's list, and customer B's own
  // order must still be present.
  {
    const label = "customerB lists Order -- sees their own, none of customerA's";
    const result = await attempt(() => blocksB.data.collection("Order").list({ fields: ["orderNumber"] }));
    const items = result.outcome === "ok" ? itemsOf(result.response, "getOrders") : [];
    const orderNumbers = items.map((item) => item?.orderNumber);
    const leaked = ["10-4821", "10-4822", "10-4823"].filter((n) => orderNumbers.includes(n));
    const seesOwn = orderNumbers.includes("10-5001");
    const clean = result.outcome === "ok" && leaked.length === 0 && seesOwn;

    if (clean) {
      record(10, label, true, `allowed -- customerB saw [${orderNumbers.join(", ")}], no customerA orders leaked`);
    } else if (result.outcome !== "ok") {
      record(
        10,
        label,
        false,
        `call failed(${result.outcome}: ${result.message}) -- expected customerB to see their own order 10-5001`
      );
    } else if (leaked.length > 0) {
      record(
        10,
        label,
        false,
        `LEAKED customerA orders into customerB's list: [${leaked.join(", ")}]; customerB saw [${orderNumbers.join(", ")}]`
      );
    } else {
      record(10, label, false, `customerB saw [${orderNumbers.join(", ")}] -- missing their own order 10-5001`);
    }
  }

  // 11. One return per order is enforced. Customer A's seeded ReturnCase
  // already covers order 10-4821; this attempts a second insert on the same
  // order and must be rejected. `ReturnCase.orderNumber` is now
  // `isUniqueData: true` and enforced server-side, but critically the
  // rejection does NOT throw and is NOT a non-2xx response -- it comes back
  // HTTP 200 with a GraphQL `errors` array (VALIDATION_ERROR /
  // validationType: Unique) and `data.insertReturnCase: null`. `attempt()`
  // already classifies a non-empty `errors` array as `graphql-error`
  // (denied), so that is the expected path here; the `data.insertReturnCase
  // === null` check in the `ok` branch below is a second, independent
  // signal so this assertion doesn't depend solely on the errors array
  // being present.
  {
    const label = "customerA cannot create a second ReturnCase on order 10-4821 (uniqueness)";
    const result = await attempt(() =>
      blocksA.data.collection("ReturnCase").create({
        customerItemId: customerAItemId,
        orderNumber: "10-4821",
        sku: "SH-022",
        status: "SUBMITTED",
        rawCustomerText: "assertion 11 probe -- duplicate return attempt on an order that already has one"
      })
    );

    if (result.outcome === "threw" || result.outcome === "graphql-error") {
      record(11, label, true, `denied(threw: ${result.message})`);
    } else {
      const payload = result.response?.data?.insertReturnCase;
      if (payload === null || payload === undefined || !payload.itemId || payload.acknowledged === false) {
        record(11, label, true, `denied(empty) -- data.insertReturnCase=${JSON.stringify(payload)}`);
      } else {
        // The insert actually went through -- a second ReturnCase now
        // exists on an order that must only ever have one. Clean it up as
        // ops (see deleteForgedReturnCase) so the fixture set stays sane
        // for the next run, then report the failure with the created id.
        const cleanup = await deleteForgedReturnCase(payload.itemId, [["ops", blocksOps]]);
        record(
          11,
          label,
          false,
          `allowed -- second ReturnCase created on order 10-4821 (itemId=${payload.itemId}); cleanup: ${
            cleanup.deleted ? "row removed" : "ROW STILL PRESENT -- remove it by hand"
          } [${cleanup.notes.join(" | ")}]`
        );
      }
    }
  }

  const passing = results.filter(Boolean).length;
  console.log(`${passing}/11 passing`);
  process.exit(passing === 11 ? 0 : 1);
}

main().catch((error) => {
  console.error(`Suite crashed: ${error.message}`);
  process.exit(1);
});
