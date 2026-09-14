# ShopReturn IAM roles

Roles have no local file representation in Blocks — they live server-side and are
created through `blocks iam roles create`. This file records what exists and why,
so the intent survives without querying the project.

Project: `Df53833214f2a4243b696b55040b32509` (ShopReturn, dev)
Created: 2026-09-14

**Role hierarchy and permission assignment key off `slug`, not `itemId`.** Every
access policy in `blocks/data/rules.json` references these slugs.

| slug | name | itemId | description |
|---|---|---|---|
| `customer` | Customer | `51664644-9460-4712-aee0-b3af6555d174` | End customer. Sees only their own returns. |
| `ops` | Ops Staff | `0eafe10b-516d-455a-a7c6-9e4b205b97f4` | Receives, inspects and decides returns. No analytics. |
| `manager` | Business Manager | `41a38c5d-05d7-493f-80c8-889b1c2b42cc` | Pattern views, financial totals, decision log. |

`clouduser` ("System User") is the platform seed and predates this project's setup.

Created flat — no `--parent-role-slug`, no `--can-create-own`. The spec's grant
matrix needs no hierarchy, and a parent relationship would inherit grants that the
matrix deliberately withholds.

## What each role may read and write

Per `docs/superpowers/specs/2026-09-14-shopreturn-design.md` §5. These grants are
enforced by Data access policies, **not** by this file and **not** by the role
definitions above — creating a role grants nothing on its own.

| Schema | `customer` | `ops` | `manager` |
|---|---|---|---|
| `ReturnCase` | read own rows, create | read all, edit | read all |
| `ReturnTimeline` | read own + `isCustomerVisible` | read all, insert | read all |
| `Inspection` | — | read, insert, edit | read all |
| `Refund` | read own, terminal only | read, insert | read all |
| `PatternAlert` | — | — | read, acknowledge |
| `Decision` | — | — | read, insert, edit |
| `Order` | read | read | read |
| update / delete on `ReturnTimeline` | — | — | — |

Two properties are structural rather than policy-checked:

- **Append-only timeline.** No role holds update or delete on `ReturnTimeline`. A
  correction is a new entry. The absence of the grant is the enforcement.
- **Inspection is invisible to customers.** They hold no grant on the schema at
  all, so "operational inspection detail is internal" needs no field masking.

Field masking is used exactly once: the `ai*` columns on `ReturnCase`
(`aiReason`, `aiConfidence`, `aiRestockable`, `aiCourierClaim`, `aiDraftMessage`)
are hidden from `customer`, who owns the row and would otherwise read the
unconfirmed AI proposal.

## Caveats

- There is no `iam roles delete` in the CLI (list / get / create / update /
  assign-permissions / assignable). Removing a role needs the portal.
- `blocks data schema push` grants every newly created schema **Public** access on
  all four operations (`accessLevel: 2`). Until the Task 6 policies reduce that,
  these role definitions constrain nothing.
