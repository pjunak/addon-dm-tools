# Scenario JSON import

DM Tools registers provider `(dm-tools, scenario-json)` using provider API 1
and schema version 1. It accepts UTF-8 JSON only and writes only the addon's
DM-only, list-shaped `scenarios` collection.

## Document shape

```json
{
  "format": "dm-tools-scenarios",
  "schemaVersion": 1,
  "scenarios": [
    {
      "id": "opening-scene",
      "operation": "create",
      "name": "Opening scene",
      "summary": "Meet at the inn.",
      "status": "planned",
      "tags": ["intro"],
      "updatedAt": "2026-07-24T10:00:00.000Z"
    },
    {
      "id": "return-to-town",
      "operation": "update",
      "name": "Return to town",
      "summary": "Debrief the mayor.",
      "status": "active",
      "tags": ["town"],
      "updatedAt": "2026-07-24T11:00:00.000Z",
      "expectedUpdatedAt": "2026-07-23T09:00:00.000Z"
    }
  ]
}
```

Only `format`, `schemaVersion`, and `scenarios` are accepted at the document
root. Scenario records accept only the fields shown above.

- `id`: 1–120 lowercase letters, digits, dots, underscores, or hyphens.
- `operation`: `create` or `update`.
- `name`: 1–120 characters after trimming.
- `summary`: optional, at most 4,000 characters after trimming.
- `status`: `planned`, `active`, or `completed`.
- `tags`: optional list of at most 20 unique strings, each 1–40 characters.
  Tags are trimmed and sorted deterministically.
- `updatedAt`: required ISO timestamp, normalized to UTC.
- `expectedUpdatedAt`: required for `update`, forbidden for `create`.

Each entry is a complete scenario replacement. Omitting optional `summary` or
`tags` deterministically normalizes that field to an empty string or empty
list; it does not preserve an older local value.

Unknown fields, malformed values, duplicate input ids, and unsupported schema
versions are error diagnostics with stable codes and record/field paths.
The host independently rejects duplicate raw JSON keys, excessive size/depth,
prototype keys, and other parser/job-limit violations before provider code.

## Reconciliation policy

- `create` + missing local id: create.
- `create` + byte-equivalent normalized local record: skip.
- `create` + different existing record: conflict.
- `update` + missing local id: conflict.
- `update` + equivalent normalized record: skip.
- `update` + changed record and matching `expectedUpdatedAt`: update.
- `update` + changed record and mismatched local `updatedAt`: conflict.

Conflicts are error diagnostics and block the entire commit. Resolving one
means correcting the source document and creating a new preview; the Import
Center never mutates the server-held plan. Local scenario records outside this
schema are rejected for update rather than having unknown data silently
dropped.

Preview performs no writes. Commit accepts only the opaque, single-use token
for that exact preview. The host rechecks provider/package and collection
revisions, then publishes the stored `put` operations atomically through F2.
A stale revision, provider update/disposal, cancellation, expiry, or failed
commit leaves the collection unchanged.
