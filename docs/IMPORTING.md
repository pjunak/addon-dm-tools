# Planning import

DM Tools registers `(dm-tools, planning-json)` using provider API 1 and planning
schema version 2. It accepts strict UTF-8 JSON and may atomically write the five
meaning-bearing keyed DM-only collections.

The exact record fields, examples, batching rules, and generation workflow live
in [`AGENT_GENERATION.md`](AGENT_GENERATION.md).

## Boundary

```json
{
  "format": "dm-tools-planning",
  "schemaVersion": 2,
  "generatedAt": 1785024000000,
  "items": [],
  "flowLinks": [],
  "references": [],
  "consequences": [],
  "notes": []
}
```

Every array must be present. Every record declares
`"operation": "create" | "update"`. Updates also carry the exact current
`expectedUpdatedAt`; creates omit it. The document `generatedAt` becomes
`updatedAt` for every changed record.

The campaign-bundle contributor envelope is:

```json
{
  "addonId": "dm-tools",
  "contributorId": "planning",
  "document": {
    "format": "dm-tools-planning",
    "schemaVersion": 2,
    "generatedAt": 1785024000000,
    "items": [],
    "flowLinks": [],
    "references": [],
    "consequences": [],
    "notes": []
  }
}
```

Inside a bundle only, the host resolves exact `{"$ref":"local.name"}` objects
before the provider runs. This is intended for `id` inside a core reference
target. Standalone imports require concrete IDs.

Before provider code runs, the host rejects duplicate JSON keys, invalid UTF-8,
prototype keys, malformed input, and configured byte, depth, string, node, and
record limits.

The provider then:

1. normalizes every record through `planning-contract.js`;
2. reads one consistent snapshot of all five planning collections and allowed
   core reference collections;
3. reconciles create, update, identical skip, and conflict in memory;
4. validates ownership, flow, anchors, and new core references against the
   complete candidate;
5. returns at most 256 exact `put` operations.

Optional-addon targets are not existence-checked. Their addon, kind, record id,
and fallback label remain strictly validated. Older missing core records do not
block unrelated imports; every core target present in the new input must exist.

## Reconciliation

- create + missing id: create;
- create + equivalent content: skip;
- create + different content: conflict;
- update + missing id: conflict;
- update + equivalent content: skip;
- update + changed content + matching `expectedUpdatedAt`: update;
- update + stale timestamp: conflict;
- changed update whose `generatedAt` is not later than local `updatedAt`:
  conflict.

Equivalence ignores `updatedAt`; time alone never causes a write. Any error
blocks the complete commit. Imports do not delete or write `planning_views`.

Preview stores the normalized plan server-side. Commit consumes an opaque
single-use token, rechecks provider/package and collection revisions, and
publishes those exact operations through one durable transaction. Cancellation,
expiry, provider change, revision conflict, or publication failure leaves all
five collections unchanged.

## Legacy data

The old scenario import format is retired. Startup translates v1 scenarios,
folders, items, sections, and links already stored in the campaign into v2
once. The transaction retains every original source record. It writes no
completion marker when any translation or v2 dataset validation fails.
