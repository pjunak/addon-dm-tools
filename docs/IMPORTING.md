# Reviewed planning imports

DM Tools owns the visible provider-neutral Import Center and one
`codex.import-adapter` v2 provider for `dm-tools-planning`.

The browser reads at most 2 MiB, parses the root object, and examines only its
string `format`. Exactly one discovered adapter must claim that format. The
complete document then crosses the broker to that provider for authoritative
validation.

## Planning workflow

The Go worker:

1. strictly parses schema-v3 records and rejects unknown or missing fields;
2. loads one revisioned snapshot of all six planning collections;
3. reconciles create, update, identical skip, and replacement deletion;
4. validates ownership, anchors, references, same-parent flow, and cycles over
   the complete candidate;
5. retains at most 256 exact mutations behind a random 15-minute token.

Preview never writes. Commit requires an idempotency key, consumes the token
once, and submits the retained mutations in one host transaction. Exact record
revisions make a concurrent planner change fail as a conflict. The worker does
not rerun reconciliation or silently merge newer data.

`merge` retains omitted records and never touches `planning_views`. `replace`
requires every incoming record to use `create`, deletes omitted semantic
records, and clears saved layouts. The preview lists those deletions and the UI
uses an explicit destructive confirmation label.

There is no permanent import path for older planning schemas. The supervised
rewrite cutover uses a separate one-time campaign converter and the downloaded
site backups as rollback evidence.
