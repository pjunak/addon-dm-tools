# Planning import

DM Tools registers `(dm-tools, planning-json)` using provider API 1 and planning
schema version 3. It accepts strict UTF-8 JSON and may atomically write the five
meaning-bearing keyed DM-only collections.

Older planning schema versions are rejected and are not converted.

The exact record fields, examples, batching rules, and generation workflow live
in [`AGENT_GENERATION.md`](AGENT_GENERATION.md).

## Document contract

```json
{
  "format": "dm-tools-planning",
  "schemaVersion": 3,
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
    "schemaVersion": 3,
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

### Local flow invariant

Every flow source and target must exist in the complete candidate and have the
same immediate `parentId`. Matching nesting depth is insufficient. A create or
update that would connect different canvases blocks the entire preview. The
provider never rolls up, retargets, deletes, or converts such a link. See
[`GRAPH.md`](GRAPH.md) for the canvas model.

Planning references and consequence targets are not flow edges and may point
across ownership scopes.

## Import Center

DM Tools owns the complete visible Import Center at `#/dm-import`. It consumes
zero or more `codex.import-adapter` v1 services and publishes its planning
workflow through that same cardinality-many contract. Adapter identity is the
provider addon id plus its descriptor id; no official addon ids or payload
schemas are hardcoded in the center. Each content owner supplies localized
metadata, review/editor HTML, registered actions, scoped import-provider calls,
safe resource/view links, and cleanup. The center activates and renders every
compatible adapter as its own section on one continuous page; it adds no
adapter tab strip. It contains descriptor invocation, descriptor property
access, and render failures, so one adapter cannot prevent another from
loading. Resource links must be parsed as
same-origin root-relative URLs: scheme-relative paths, backslashes, control
characters, and cross-origin results are rejected. The center never parses an
adapter's documents.

The planning adapter remains paired with `(dm-tools, planning-json)` and owns
the workflow below. Core campaign data is a separate built-in adapter using the
same service shape. Disabling or updating any adapter reloads DM Tools after
the adapter is disposed; the server job's provider/package/content and
collection revision pins prevent a stale preview from committing.

Before provider code runs, the host rejects duplicate JSON keys, invalid UTF-8,
prototype keys, malformed input, and configured byte, depth, string, node, and
record limits.

## Provider workflow

The provider then:

1. normalizes every record through `planning-contract.js`;
2. reads one consistent snapshot of all five planning collections and allowed
   core reference collections;
3. reconciles create, update, identical skip, and conflict in memory;
4. validates ownership, same-parent flow, anchors, and new core references
   against the complete candidate;
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
