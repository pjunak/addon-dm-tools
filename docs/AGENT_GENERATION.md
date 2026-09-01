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
