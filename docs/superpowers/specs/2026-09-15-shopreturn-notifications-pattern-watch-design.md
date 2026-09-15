# ShopReturn — Notifications and Pattern Watch

**Date:** 2026-09-15
**Status:** Approved design (sections 1 and 2 approved in brainstorming)
**Extends:** `docs/superpowers/specs/2026-09-14-shopreturn-design.md` (§6.2 pattern detection, §9 open question 2)

## Source requirement

From `05-ShopReturn.pdf`:

> Push it further: have the AI watch the growing set of returns and proactively raise a pattern alert — a SKU or courier crossing a return-rate threshold — with a draft explanation of the likely cause, **before the manager has to notice it on a dashboard.**

And from the personas: **ops staff** "receives, inspects, decides"; the **business manager** acts on patterns — "fix the size chart, pause COD in a zone, file a courier claim."

## Goal

1. When a customer submits a return, ops is notified.
2. When the growing set of returns pushes a SKU, area or courier across the return-rate threshold, a pattern alert is raised with a drafted explanation, and the manager is notified — before they open the dashboard.

## Platform facts this design rests on

Every item below was verified against the live project on 2026-09-15. Nothing in this spec depends on an unverified capability.

| Fact | Evidence |
|---|---|
| Notification configuration `shopreturn` exists: `channelToNotify: 0` (SignalR), `notificationType: 2` (UserSpecificReceiverType), `notifyMethod: "shopreturn"`, `enablePersistence: true`, `itemId aadbf206-1421-4998-90ef-c6122e890260`. | `blocks notification list --page 0` |
| `notify()` requires five fields the SDK types mark optional: `configurationName`, `connectionId` (`""` is accepted), `responseKey`, `responseValue`, `denormalizedPayload`. A missing configuration fails **200 + `isSuccess: false`**, not an HTTP error. | Raw call to `/logic/v4/Notifier/Notify` |
| A **customer** session may notify role `ops`; an **ops** session may notify role `manager`. | Probe: both sends accepted and delivered |
| **Role-targeted** and **user-id-targeted** sends both deliver under the stored configuration. | Both probe styles present in the ops and manager inboxes |
| A notification to `ops` does **not** reach the sending customer's inbox. | Customer inbox empty after probes |
| `getNotifications` and `notification list` are **zero-indexed**: `page: 1` of a one-page inbox returns an empty list while `totalNotificationsCount` is non-zero. | Inbox reads at page 1 vs page 0 |
| Inbox items have shape `{ id, correlationId, payload, denormalizedPayload, createdTime, readByUserIds, readByRoles, isRead }`. With `saveDenormalizedPayloadAsAnObject: true`, `denormalizedPayload` reads back as a parsed object. | Page-0 inbox read |
| The SDK has **no real-time client** (no SignalR hub connection) and `@microsoft/signalr` is not installed. The notifier exposes only `notify`, `getNotifications`, `getUnreadNotificationsBySubscriptionFilter`, `markNotificationAsRead`, `markAllNotificationAsRead`. | `@seliseblocks/client` type declarations |
| **No role can insert a `PatternAlert` today.** Grants are `manager-reads-pattern-alerts` (read) and `manager-edits-pattern-alerts` (update) only. The fixture alert predates deployed policies. | `blocks/data/rules.json` |
| **No role can delete a `PatternAlert`.** | `blocks/data/rules.json` |
| `isUniqueData` is enforced: a duplicate insert fails as **200 + GraphQL `errors`** ("A record with the same value for '…' already exists.") with a null payload. | Access harness assertion #11 |
| The CLI exposes no scheduler, cron, trigger, or agent runtime. | `blocks --help` |
| Ops reads every `Order` and `ReturnCase` (`staff-reads-all-orders`, ops return read policy), so an ops browser can compute every facet. | Access harness, grant matrix |

Current data (361 orders, 69 returns) has three facets at or above 30%: **SKU SH-022 (37.8%)**, **area Mirpur 11 (31.0%)**, **courier Sundarban Courier (31.0%)**. The smallest facet has 40 orders.

## Non-goals

- **Real-time push.** No SignalR connection; the bell reads the persisted inbox. A SignalR spike can follow later without changing senders.
- **Calling a Blocks Agent.** Programmatic invocation is unverified. The explanation is drafted deterministically behind an interface an agent can later fill.
- **A server-side scheduler or trigger.** Detection runs in the ops browser at the moment of confirmation.
- **A date window** on detection. Rates are all-time, as on the dashboard.
- **Notifying customers.** Their timeline already tells them what happened.

---

## §1 — Pattern Watch detection

### Trigger

After **ops accepts a return** (`useReviewReturn.accept` in `app/src/features/ops/useReviewReturn.ts`) and that accept has succeeded, the ops browser runs detection. Detection never blocks, delays the user-visible result of, or undoes the accept: it starts after the accept resolves, and any failure is logged and swallowed.

Reject does not trigger detection. Accept is the moment ops confirms the return and its reason — the requirement's "that confirmation trips SH-022 past 38%".

### Detection rule

Detection reuses the dashboard's aggregation (`computeInsights` in `app/src/features/insights/analytics.ts`) over every `Order` and `ReturnCase`, paged with the same fail-loudly read path (`itemsOrThrow`). An alert and the Analytics page can therefore never disagree about a number.

A facet raises an alert when **all** hold:

- dimension is `SKU`, `AREA` or `COURIER` (the `byProduct`, `byArea`, `byCourier` facets);
- the facet key is not `UNSPECIFIED` — a "not recorded" bucket is not a place or product anyone can act on;
- `orders >= 20` (`MIN_ORDERS`) — below this a handful of returns produces a meaningless rate;
- `rate >= 0.30` (`BREACH_RATE`) — the same threshold the fixture alert and the facet bars already use.

The constants live in one module and are imported by both detection and `FacetBars`, so the dashboard's breach styling and the alert threshold cannot drift apart.

### One alert per facet per week — without reading

Ops cannot read `PatternAlert` (by design), so ops cannot check whether a breach was already flagged. The platform enforces it instead.

- New field on `PatternAlert`: **`alertKey` (String, `isUniqueData: true`)**.
- Format: `${DIMENSION}:${facetKey}:${isoWeek}`, e.g. `SKU:SH-022:2026-W38`, `AREA:Mirpur 11:2026-W38`, `COURIER:Sundarban Courier:2026-W38`.
- `isoWeek` is the **ISO-8601 week-numbering year and week**, zero-padded: `YYYY-Www`. At year boundaries the week-numbering year can differ from the calendar year (29 Dec 2025 is `2026-W01`); the implementation must use ISO week-year, not calendar year.
- Detection inserts; a uniqueness rejection means "already raised this week" and is **not** an error — it sends no notification and logs nothing alarming.
- The key's week means a breach that persists re-surfaces the following week rather than never again.
- **Order of rollout matters for uniqueness.** `PatternAlert` holds exactly one existing row today. The sequence is: push the schema with `alertKey`, backfill that one row, then deploy the insert policy, then ship detection. Adding a unique column is safe only because no two existing rows can collide on an empty key; if more rows exist at rollout time, each must be backfilled with a distinct key before the unique constraint is relied on.
- **Backfill:** the existing fixture alert (`ee6d9ac1-9451-4f2b-b9ea-e762fa7b3eaf`, SH-022) is given `alertKey` `SKU:SH-022:<ISO week at migration time>` by the manager before detection ships, so the next confirmation does not raise a duplicate SH-022 alert.

### Alert fields written

| Field | Value |
|---|---|
| `alertKey` | as above |
| `dimension` | `SKU`, `AREA` or `COURIER` |
| `value` | the facet key (`SH-022`, `Mirpur 11`, `Sundarban Courier`) |
| `metric` | return rate as a percentage to one decimal (`31.0`) |
| `threshold` | `30` |
| `takaImpact` | the facet's taka impact |
| `contributingReturnIds` | JSON array string of that facet's return case ids |
| `draftExplanation` | see below |
| `raisedAt` | ISO timestamp at detection |
| `acknowledgedBy` | `""` |

### Drafted explanation

A pure function `draftExplanation(dimension, facet, rows)` builds the sentence from **that facet's own returns** (never the global rankings, which would pin another facet's problem on it), naming the most common value of each *other* dimension and the most common reason:

- `SKU` — template "{returns} of {orders} {product} ({sku}) orders were returned ({rate}), {taka}. Most came from {area} via {courier}, most often {reason}." — e.g. "31 of 82 Canvas Sneaker (SH-022) orders were returned (37.8%), ৳44,950. Most came from Mirpur 11 via Sundarban Courier, most often damaged in transit."
- `AREA` — template "{returns} of {orders} orders in {area} were returned ({rate}), {taka}. Most were {product} ({sku}) via {courier}, most often {reason}." — e.g. "26 of 84 orders in Mirpur 11 were returned (31.0%), …"
- `COURIER` — template "{returns} of {orders} {courier} orders were returned ({rate}), {taka}. Most were {product} ({sku}) in {area}, most often {reason}." — e.g. "26 of 84 Sundarban Courier orders were returned (31.0%), …"

When a secondary breakdown is empty (for example, no area recorded on any of the facet's returns), that clause is omitted rather than printing `UNSPECIFIED`.

The stored sentence is **English**: it is data recorded at detection, not UI chrome. The alert strip already labels it "Agent's draft explanation, not yet confirmed"; that label key is reworded to **"Drafted from the return data, not yet confirmed"** (en and bn), because no AI wrote it.

The function signature is the seam for a future Blocks Agent: an agent-backed drafter can replace it without changing detection.

### Access control change

- New policy **`ops-inserts-pattern-alerts`**: `PatternAlert`, operation insert, rule `roles == ops`.
- Ops still has **no read and no update** on `PatternAlert`. The wall between ops and management stays intact.
- The schema change (`alertKey`) and the policy are pushed with the usual dry-run and approval.

### Trust boundary

Detection runs in the ops browser, so an ops user could in principle forge an alert. Ops is an internal party, an alert is advisory, and the manager decides whether to act. This is a client-side trust boundary, accepted deliberately and stated here.

---

## §2 — Notifications

### Sender helper

`notifyRole(role, kind, payload)` in `app/src/lib/blocks/notify.ts`:

- sends `{ configurationName: "shopreturn", connectionId: "", responseKey: "shopreturn", responseValue: kind, roles: [role], denormalizedPayload: JSON.stringify({ kind, ...payload }), saveDenormalizedPayloadAsAnObject: true }`;
- returns `true` on success; treats a GraphQL `errors` array, an `errors` object with keys, `isSuccess: false`, or a thrown error as failure and returns `false`;
- never throws into the caller.

### The two sends

| Event | Sender session | Target role | `kind` | Payload |
|---|---|---|---|---|
| Customer submits a return (`useSubmitReturn`, after the `ReturnCase` insert succeeds) | customer | `ops` | `RETURN_SUBMITTED` | `returnId`, `orderNumber`, `productName` |
| Pattern Watch inserts a **new** alert (insert succeeded, not a uniqueness rejection) | ops | `manager` | `PATTERN_ALERT` | `alertKey`, `dimension`, `value`, `metric` |

Both are fire-and-forget after the primary write has landed. A failed send is logged; the return or alert still exists.

Payloads carry identifiers, order numbers and rates only — no customer contact details and no raw complaint text.

### The bell

`app/src/app/layout/NotificationsMenu.tsx` becomes a live inbox. Its current comment ("Blocks does not expose a notifications API") is false and is replaced.

- Reads `getNotifications({ page: 0, pageSize: 20 })` — **page 0**, because the endpoint is zero-indexed.
- Badge shows `unReadNotificationsCount`, hidden at zero, capped at `9+`.
- Refreshes when the menu opens, when the window regains focus, and every 30 seconds while the tab is visible.
- Each item renders via a pure `describeNotification(item)` mapping from `denormalizedPayload.kind` to a translated sentence and a link:
  - `RETURN_SUBMITTED` → "New return for order {orderNumber}" → `/ops/review?id={returnId}`
  - `PATTERN_ALERT` → "{value} return rate is {metric}%" → `/insights`
  - anything else → a generic "New notification" with no link — an unknown kind never crashes the menu.
- Clicking an item marks it read (`markNotificationAsRead({ id })`) and navigates.
- "Mark all read" calls `markAllNotificationAsRead()`.
- Read failures surface as a short error line inside the menu, not as "You're all caught up" — an empty state must mean empty, never failed (the same rule as `itemsOrThrow`).
- Unread items are visually distinct by weight **and** a text marker, not by colour alone.

### Localisation

New keys, exactly these, in all three dictionaries: `notifications.title`, `notifications.empty`, `notifications.loadError`, `notifications.markAllRead`, `notifications.unread`, `notifications.returnSubmitted` ("New return for order {orderNumber}"), `notifications.patternAlert` ("{value} return rate is {metric}%"), `notifications.generic` ("New notification"). One existing key changes value: `insights.alerts.draftLabel` becomes "Drafted from the return data, not yet confirmed". Pushed to Blocks Localization with dry-run and approval.

### Limits, stated plainly

- A customer session **is** permitted to notify ops, so a malicious customer could flood the ops inbox. Notifications are advisory; the review queue remains the source of truth.
- There is no server-side trigger. If the browser closes between the write and the send, that notification is lost; the case or alert still exists and still appears in its own screen.

---

## Testing

**Unit (vitest)**
- Detection rule: threshold boundary (exactly 30%), `MIN_ORDERS` boundary (19 vs 20), `UNSPECIFIED` excluded, all three dimensions.
- `isoWeek`: mid-year, and the year-boundary cases (29 Dec 2025 → `2026-W01`; 1 Jan 2027 → `2026-W53`).
- `alertKey` formatting.
- `draftExplanation`: each dimension, and a facet with a missing secondary breakdown.
- `notifyRole` failure detection across every failure shape listed above.
- `describeNotification`: both kinds and an unknown kind.

**Access harness** (`tools/access-check/assertions.mjs`) — refusals only, so no probe leaves debris:
- #15 a customer cannot insert a `PatternAlert`.
- #16 ops cannot update a `PatternAlert` (acknowledging stays manager-only).
- #13 unchanged: ops still cannot read `PatternAlert` or `Decision`.

Ops' new insert right is **not** probed in the harness: no role can delete an alert, so a probe insert would leave a permanent fake alert in the manager's strip. It is proven by the end-to-end run below, whose alerts are real.

**End to end (headless, live project)**
- A customer submission produces a `RETURN_SUBMITTED` item in the ops inbox (read at page 0) and nothing in the customer inbox.
- An ops accept that leaves Mirpur 11 and Sundarban Courier above threshold produces their two alerts with correct `alertKey`, `metric`, `threshold` and a non-empty explanation, and a `PATTERN_ALERT` item in the manager inbox for each.
- A second accept in the same week produces **no** further alerts and **no** further manager notifications.
- Probe notifications created by the run are marked read afterwards.

## Demo impact

The first ops acceptance after this ships raises **Mirpur 11** and **Sundarban Courier** alerts and pings the manager — both genuine breaches, and the requirement's own story ("24 of 31 returns from Mirpur via one courier"). SH-022 does not duplicate, because the fixture alert is backfilled with its key.

## Follow-ups (not in this design)

- Spike: can a Blocks Agent be invoked programmatically? If yes, implement an agent-backed `draftExplanation`.
- Spike: connect the bell to the SignalR hub for instant delivery, keeping the persisted inbox as fallback.
