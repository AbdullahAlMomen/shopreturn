# ShopReturn data-access semantics — observed, not documented

Everything below was established by deploying a change to `blocks/data/rules.json`
against the live project `Df53833214f2a4243b696b55040b32509` and observing what four
signed-in test users (one `customer` A, one `customer` B, one `ops`, one `manager`)
could actually read and write. None of it is documented by the Blocks CLI, its
skills, or the API. Where a claim is made below, the observation behind it is given.

Read this together with
`.superpowers/sdd/2026-09-14-shopreturn-blocks-foundation/data-access-contract.md`,
which describes the *shape* of `rules.json`. This file describes what the values
inside that shape **do**.

Two denial shapes appear throughout and they mean different things:

- **`401 Unauthorized`** — the caller may not run the query at all. No allow policy
  applied to them for that schema + operation.
- **`200` with an empty item list** — the query ran, and a row-level filter from an
  allow policy removed every row.

---

## 1. `accessLevel` — the gate that decides whether policies run at all

Set per schema **and per operation** in `security[]`. The CLI names the enum in a
source comment (`blocks-cli/src/lib/data-gateway.ts`):
`Inherited = 0, User = 1, Public = 2, Custom = 3`. What each does in practice:

| value | name | observed behaviour |
|---|---|---|
| `0` | Inherited | **Permissive.** `PatternAlert` read was set to `0` with no policy on it; customer A still listed the row. Policies are not consulted. |
| `1` | User | **Any authenticated user is allowed; policies are ignored.** With `ReturnCase` read at `1` *and* a deployed allow policy restricting rows to the owner, customer **B** still read customer A's row. The policy had no effect. |
| `2` | Public | What `blocks data schema push` sets on every schema it creates. Anonymous-readable; policies ignored. |
| `3` | Custom | **The only level at which policies are evaluated.** With `Inspection` read at `3` and no policy, customer A got `401`. With a matching allow policy, the same call returned rows. |

**Consequence: `accessLevel: 1` is not a tightening.** The version of `rules.json`
authored before this task used `1` everywhere; deploying it changed nothing except
locking out anonymous callers, and the assertion suite stayed at 3/6. Every
operation on every schema in the shipped file is therefore `3`.

There is one extra `security[]` entry with `policyType: 1` and a `fieldNames` list —
see §5.

## 2. How a policy binds to a role

**A policy binds to a role through a rule on the `roles` claim. There is no `roles`
field on the policy object, and none is needed.**

```json
{ "leftSource": 0, "leftOperand": "roles", "operator": 0, "rightSource": 2, "staticValue": "ops" }
```

Evidence: a single allow policy carrying only that rule was deployed on `Inspection`
read. `ops` listed the row; customer A, customer B and `manager` all got `401`. The
same rule with `"manager"` on `PatternAlert` admitted only `manager`. Both `roles`
and `Roles` work (the lookup is case-insensitive — see §3).

The role value is the **role slug** as it appears in the access token: `customer`,
`ops`, `manager` — the slugs from `blocks/iam/roles.md`.

IAM permissions (`blocks iam roles assign-permissions`, permission type `3`
`DataProtection`) were **not needed** and were not touched. Field masking, which was
the reason to suspect IAM, turned out to be expressible in `rules.json` (§5).

**No unconditional-allow policy was deployed, and none is needed** — see §6, which
shows a rule-less policy denies rather than allows.

## 3. The claim for the calling user's id is `UserId`

```json
{ "leftSource": 1, "leftOperand": "customerItemId", "operator": 0, "rightSource": 0, "rightOperand": "UserId" }
```

Evidence: three allow policies were deployed at once on three different schemas, each
comparing one candidate claim name against customer A's literal user id. `UserId`
(on `ReturnTimeline`) and `userId` (on `Inspection`) both admitted customer A and
gave customer B `401`. `user_id` (on `ReturnCase`) gave customer A `401`.

This matters: **`user_id` is the claim name in the raw JWT** (decoded payload:
`sub`, `user_id`, `roles`, `tenant_id`, `org_id`, …), but the data gateway does not
read raw JWT names. It exposes a normalised set in which the user id is `UserId`
(case-insensitively) and the role is `roles`. `sub` did not resolve either (tested
against its literal `blocks|<id>` value). **Do not derive claim names from the token.**

Claim names are still not validated at write time — deploying `ThisClaimDoesNotExist`
succeeds with `isSuccess: true`. A wrong name fails silently at query time, as a row
filter that matches nothing. This was used deliberately as a falsification check —
see §7.

## 4. `operator` and `logicalOperator`

| field | value | meaning | evidence |
|---|---|---|---|
| `operator` | `0` | **equals** | used by every rule in the shipped file; behaves as equality against claims, literals and row fields. |
| `operator` | `1` | **not equals** | a policy `roles != "customer"` on `Refund` admitted `ops` and `manager` (`200`, empty collection) and gave both customers `401`. |
| `logicalOperator` | `0` | **AND** | `roles == "customer"` AND `customerItemId == UserId` on `ReturnCase`: customer A got their row; customer B got `200` + zero rows (role rule passed, row filter excluded); `ops`/`manager` got `401` (role rule failed). Both halves demonstrably applied. |
| `logicalOperator` | `1` | **OR** | `roles == "ops"` OR `roles == "manager"` on `Decision` admitted both and denied both customers. |

Operator values `2` and above were not probed.

## 5. Static values, field types, and field masking

**A static value goes in `staticValue`, not in `rightOperand`.** This is the single
easiest thing to get wrong, because the server accepts either without complaint.

- `{"rightSource": 2, "rightOperand": "<A's id>"}` on `customerItemId` matched **zero**
  rows even though the seeded row holds exactly that value.
- `{"rightSource": 2, "staticValue": "<A's id>"}` on the same field matched the row.

`rightOperand` is the operand **name** (a claim name when `rightSource` is `0`, a
field name when it is `1`); `staticValue` is the operand **value** when `rightSource`
is `2`.

**Booleans must be real JSON booleans.** `{"leftOperand": "isCustomerVisible",
"rightSource": 2, "staticValue": "true"}` (string) matched nothing; `"staticValue":
true` matched the seeded visible row.

**Field masking is `policyType: 1`, and it needs two pieces.** `policyType: 0` (RLS)
rejects `fieldNames` outright — the deploy fails with
`400 FIELD_NAMES_ARE_NOT_ALLOWED_FOR_ROW_LEVEL_SECURITY`. The working arrangement is:

1. a `security[]` entry with `policyType: 1`, `accessLevel: 3` and the `fieldNames`
   to protect, and
2. a policy with `policyType: 1`, the same `fieldNames`, and a rule saying who may
   read them.

Applied to the five `ai*` columns on `ReturnCase` with the rule
`roles == "ops" OR roles == "manager"`, the owning customer still reads their row and
every other field normally, and gets `aiReason: null` — verified by requesting
`["aiReason", "status", "sku"]` in one call and receiving
`{"aiReason": null, "status": "SUBMITTED", "sku": "SH-022"}`. The field is withheld,
not the row.

## 6. A policy with no rules denies everything

An allow policy with `ruleGroup.rules: []` was deployed alone on `ReturnCase` read at
`accessLevel: 3`. Every role got `401`, including the row's owner.

This inverts the risk this work was planned around. The 20 rule-less policies in the
pre-task draft of `rules.json` would not have opened the data up; they would have
granted nothing at all while looking as if they granted something. Either way they
were wrong, and none survives in the shipped file — every one of the 24 policies now
carries at least one rule.

**Multiple allow policies on the same schema + operation union (OR) together.**
`ReturnCase` read carries three separate allow policies (one per role); `ops` is
admitted by `ops-reads-all-returns` even though `customer-reads-own-returns` excludes
them. This is why each role gets its own named policy rather than one policy with a
long OR chain — it keeps the grant matrix readable and each grant individually
removable.

## 7. Proof the claim is actually doing the work

With all six assertions passing, `rightOperand` in `customer-reads-own-returns` was
changed from `UserId` to `ThisClaimDoesNotExist` and redeployed:

```
PASS #1 customerB reads customerA's ReturnCase -- denied(empty)
FAIL #2 [CONTROL] customerA reads their own ReturnCase -- BOUNDARY TOO TIGHT ...
5/6 passing
```

Assertion 2 flipped from PASS to FAIL and the row became invisible to its own owner.
The claim lookup is real; the green suite is not an accident of some unrelated
denial. `UserId` was restored and redeployed, returning the suite to 6/6.

## 8. Operational notes

- `blocks data rules deploy` already reloads the gateway (its response carries
  `gatewayReload: {"message": "Schema evicted successfully."}`), so a separate
  `data reload` is not required after it. `blocks data sync --yes` was also run
  end-to-end and left the suite at 6/6 — the schema push inside it does **not**
  re-apply Public access to schemas that already exist, only to ones it creates.
- `policy/update` is keyed on `policyName` per schema, and the update request sends
  only `fieldNames`, `isAllowPolicy`, `policyDescription`, `policyName`, `priority`
  and `ruleGroup`. **Changing `operation` or `policyType` on an existing policy name
  silently does nothing** — delete the policy
  (`blocks data rules policy delete <itemId>`) and redeploy it instead.
- `entityName` comes back as `""` from `policy/get`; the CLI falls back to the schema
  name it queried by. Harmless, but do not rely on the field.
- `security[]` entries take a literal `schemaId`; policies take a `schemaName`. The
  file is therefore not portable between projects. Expected.

## 9. What the shipped policy set enforces

Matches the grant matrix in `blocks/iam/roles.md`. Verified by listing every
collection as each of the four users:

| | `customer` A | `customer` B | `ops` | `manager` |
|---|---|---|---|---|
| `Order` | read | read | read | read |
| `ReturnCase` | own row only | 0 rows (A's row filtered out) | all | all |
| `ReturnCase.ai*` | `null` | — | readable | readable |
| `ReturnTimeline` | own + customer-visible | 0 rows | all | all |
| `Inspection` | `401` | `401` | all | all |
| `Refund` | own only | own only | all | all |
| `PatternAlert` | `401` | `401` | `401` | all |
| `Decision` | `401` | `401` | `401` | all |

Two properties are enforced by the **absence** of a policy, not by a rule:

- **`ReturnTimeline` is append-only.** No role holds an edit or delete policy on it.
  Assertion 6 (`ops` updates a timeline row) is denied with `401` for this reason.
- **`Inspection` is invisible to customers.** No customer policy exists on it, so
  there is nothing to mask.

`Order`, `PatternAlert` and `Decision` carry no write policy for `ops`, and nothing
carries a delete policy for anyone.

## 10. Still unknown

- **Whether a row-field rule (`leftSource: 1`) is evaluated against an inbound row on
  write/edit.** `customer-creates-returns` therefore checks only the role, and the
  writing client is responsible for setting `customerItemId` correctly. A customer
  could currently insert a `ReturnCase` naming someone else as owner. Closing this
  needs either a probe of `leftSource: 1` on `operation: 1`, or server-side stamping
  of `customerItemId` from the token.
- `operator` values `2` and above, and `ruleGroup.nestedGroups` — unprobed. Every
  shipped rule needs only `0`/`1` and a flat rule list.
- `rightOperands` (plural) on a rule — present on read-back, always `[]`, never
  exercised. Presumably for set-membership operators.
- The `roles` claim held exactly one role in all four test tokens. How a multi-role
  user is matched (substring, list membership, first role only) is **not known**.
- `accessLevel: 0` ("Inherited") — inherits from *what* is unknown. Observed
  permissive; not used in the shipped file.
- **Re-seeding now fails.** `tools/access-check/seed.mjs` signs in as `ops` and
  inserts `Order`, `PatternAlert` and `Decision` rows, which the grant matrix gives
  to nobody / to `manager`. The existing fixtures are unaffected (the script is
  idempotent and skips rows already recorded in `fixture-ids.json`), but creating
  fresh ones requires either temporarily relaxing those schemas or a service
  identity. This is deliberate: the matrix is the spec, and it was not widened to
  keep a fixture script convenient.
