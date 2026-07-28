# Planning import

DM Tools registers `(dm-tools, planning-json)` using provider API 1 and planning
schema version 1. It accepts strict UTF-8 JSON and can atomically write the
keyed DM-only collections `planning_folders`, `planning_items`, and
`planning_links`.

The full record schema, examples, batching rules, and agent workflow live in
[`AGENT_GENERATION.md`](AGENT_GENERATION.md). This file documents runtime
behavior.

## Boundary

The root document is:

```json
{
  "format": "dm-tools-planning",
  "schemaVersion": 1,
  "generatedAt": 1785024000000,
  "folders": [],
  "items": [],
  "links": []
}
```

Every record declares `operation: "create" | "update"`. Updates also require
the exact current `expectedUpdatedAt`; creates must omit it. `generatedAt`
becomes the stored `updatedAt` for changed records.

The provider also registers as the host campaign-bundle contributor
`(dm-tools, planning)`. Its envelope is:

```json
{
  "addonId": "dm-tools",
  "contributorId": "planning",
  "document": {
    "format": "dm-tools-planning",
    "schemaVersion": 1,
    "generatedAt": 1785024000000,
    "folders": [],
    "items": [],
    "links": []
  }
}
```

The nested `document` is otherwise the same schema. Before the planning
provider runs, the host replaces any exact `{"$ref":"local.name"}` object with
the persistent core ID reserved by that campaign preview. This is intended for
`id` inside a `scope:"core"` link endpoint. It is not accepted by the
standalone planning import, which continues to require a concrete string ID.
The host validates the provider output against its existing declaration and
journal-publishes the reviewed core and DM Tools writes together. Contributor
code is not rerun during commit.

Before provider code runs, the host rejects duplicate JSON keys, invalid
UTF-8, prototype keys, malformed input, and configured byte, depth, string,
node, and record limits.

The provider then:

1. normalizes every record through `planning-contract.js`;
2. reads one consistent snapshot of all three planning collections and allowed
   core reference collections;
3. applies create/update/skip/conflict reconciliation in memory;
4. validates the complete candidate folder graph and every planning/core
   endpoint;
5. returns at most 256 exact `put` operations.

External-addon endpoints are not existence-checked so addons remain optional.
Their identity and fallback label are still schema-validated.

## Reconciliation

- `create` with a missing id creates the record.
- `create` with equivalent existing content skips it.
- `create` with different existing content conflicts.
- `update` with a missing id conflicts.
- `update` with equivalent content skips it.
- `update` with changed content and matching `expectedUpdatedAt` updates it.
- `update` with a stale `expectedUpdatedAt` conflicts.
- a changed update whose `generatedAt` is not later than the current
  `updatedAt` conflicts.

Equivalence ignores `updatedAt`; generation time alone never causes a write.
Any error diagnostic blocks the whole commit. Imports do not delete.
Core ids are existence-checked for links present in the import. A core record
deleted after an older link was saved does not block unrelated planning edits;
the graph renders that older endpoint by id until the DM removes or replaces
the link.

Preview is read-only and holds the normalized plan server-side. Commit consumes
its opaque single-use token, rechecks provider/package and participating
collection revisions, and publishes the exact stored operations through one
durable host transaction. A stale revision, cancellation, expiry, provider
change, or failed commit leaves all three collections unchanged.

## Legacy provider

`(dm-tools, scenario-json)` remains registered temporarily for compatibility
with existing scenario files. The normal Import Center selects
`planning-json`. On addon startup, valid legacy scenarios are copied
non-destructively into `planning_items` as `scenario` items when their ids do not
conflict. Original scenario records are retained.
