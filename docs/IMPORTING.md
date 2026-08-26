# Planning import

DM Tools registers `(dm-tools, planning-json)` using provider API 1 and planning
schema version 3. It accepts strict UTF-8 JSON and may atomically write or
delete records in the five meaning-bearing keyed DM-only collections. Explicit
replacement also clears the keyed `planning_views` layout collection.

Older planning schema versions are rejected and are not converted.

The exact record fields, examples, batching rules, and generation workflow live
in [`AGENT_GENERATION.md`](AGENT_GENERATION.md).

## Document contract

```json
{
  "format": "dm-tools-planning",
  "schemaVersion": 3,
  "generatedAt": 1785024000000,
  "mode": "merge",
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

`mode` is optional and defaults to `"merge"`. Merge is the normal incremental
workflow and retains records omitted from the document. `"replace"` is an
explicit full-snapshot workflow: every incoming record must use `"create"`,
matching IDs are overwritten, stored IDs omitted from the document are
deleted, and saved canvas layouts are cleared. The complete replacement is
validated and listed in preview before one atomic commit. Use it only when the
document intentionally represents the entire planner, such as recovery from
pre-v3 stored data. A replacement whose combined writes and deletions exceed
256 operations is rejected rather than partially applied.

The campaign-bundle contributor envelope is:

```json
{
  "addonId": "dm-tools",
  "contributorId": "planning",
  "document": {
    "format": "dm-tools-planning",
    "schemaVersion": 3,
    "generatedAt": 1785024000000,
    "mode": "merge",
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
   core reference collections, plus saved layouts for explicit replacement;
3. reconciles create, update, identical skip, and conflict in memory;
4. validates ownership, same-parent flow, anchors, and new core references
   against the complete candidate;
5. returns at most 256 exact `put`/`delete` operations.

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
blocks the complete commit. Merge imports never delete or write
`planning_views`.

### Complete replacement

If merge encounters stored records from an older or invalid schema, it reports
one actionable finding per affected collection instead of flooding the preview
with one error per record. In the planning adapter, **Preview complete
replacement** creates a new source document with `"mode":"replace"` and asks
the server for a second preview. The original blocked preview changes nothing.

Replacement treats the five incoming arrays as the exact desired state. It
lists every write and delete, including layout cleanup, and requires a separate
confirmation that explicitly mentions deletions. A campaign-bundle contribution
uses the same behavior by setting `mode` inside its nested planning `document`.
The host still rechecks all participating collection revisions at commit, so a
change after preview invalidates the whole replacement.

Preview stores the normalized plan server-side. Commit consumes an opaque
single-use token, rechecks provider/package and collection revisions, and
publishes those exact operations through one durable transaction. Cancellation,
expiry, provider change, revision conflict, or publication failure leaves all
six participating collections unchanged.
