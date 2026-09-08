# Generated planning JSON

Human-authored tools and language models may propose the same reviewed format:

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

Every array is required. `mode` is optional and defaults to `merge`. Every
record adds `"operation":"create"` or `"operation":"update"`; update also
adds the exact stored `expectedUpdatedAt`. Neither field is stored. The root
`generatedAt` becomes `updatedAt` on every changed record.

Stored fields are defined by the JSON schemas under `contracts/`. Important
semantic rules are:

- IDs use lowercase letters, digits, dots, underscores, and hyphens.
- item kinds are `plotline`, `quest`, `event`, and `branch`;
- event types are `story`, `encounter`, and `puzzle`;
- branch types are `decision`, `condition`, and `random`;
- flow kinds are `continues` and `option`;
- flow connects different direct siblings and remains acyclic;
- reference targets use `planning`, `core`, or `external` scope and always
  keep a human fallback name;
- consequences attach to an item or flow; DM-note anchors name planning items.

A create over an existing different record conflicts. An update requires a
matching timestamp and a later `generatedAt` if content changed. Equivalent
content is skipped regardless of timestamp. One preview may contain at most
256 writes and deletions.

Use `replace` only for an intentional complete snapshot. Every incoming record
then uses `create`; omitted planning records and all layouts are listed for
deletion before commit.

## Worked examples

[The complete sibling-flow example](examples/planning-siblings.json) creates a
plotline with two child quests and a continues flow between those quests. Both
flow endpoints have exactly the same parentId. In an empty dataset it previews
four creates and no deletions; preview remains read-only.

[The invalid flow fragment](examples/planning-cross-parent-flow.json) is not a
complete import. Replace the valid example's single flowLinks entry with it to
see a rejected child-to-parent link: example-find-courier and example-plotline
have different immediate parents. The real preview rejects it as crossing
canvas scopes. Changing the direction or label does not repair that ownership
violation; use a reference annotation when the intent is an association.

These synthetic IDs and timestamps are example data, not campaign identifiers
or a clock source. New records need unique IDs in the target campaign. For an
update, read the current stored record through the authorized planning data
boundary and use its exact updatedAt as expectedUpdatedAt; use a later
generatedAt for changed content. Never guess a timestamp from an old example,
and obtain a fresh preview after a conflict. Do not replay a commit whose
outcome is uncertain; inspect current data first.

Stored [item](../contracts/planning-item.schema.json) and
[flow](../contracts/planning-flow.schema.json) schemas own field shapes. The
import envelope adds operation/expectedUpdatedAt and supplies the authoritative
generatedAt timestamp as described above. The examples are exercised through
the actual worker preview by [documentation_test.go](../internal/importer/documentation_test.go):

~~~text
go test ./internal/importer -run TestDocumentedPlanningExamples
~~~
