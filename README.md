# DM Tools

DM Tools adds a private story planner and reviewed planning imports to TTRPG
Codex. The DM overview shows planning totals, shortcuts and recent items.
English and Czech controls follow the host language.

## Plan a campaign

Organize plotlines and quests into a tree, then connect sibling events and
branches with directed story flow. Add references, planned consequences and
shared DM notes without turning the planner into a combat or session engine.

Select cards to read or edit them, move groups, connect flow, and review subtree
deletion. The planner preserves drafts while it stays open and warns before
leaving. A read-only map panel links locations to related planning items.

See the [planner guide](docs/PLANNER.md) for controls, shortcuts, draft recovery
and navigation. The [graph contract](docs/GRAPH.md) explains ownership, atomic
writes and conflict handling.

## Import planning

In the Import Center, choose or drop a JSON file, review the proposed changes
and warnings, then apply the exact reviewed plan. Providers advertise supported
formats through `codex.import-adapter` v2. Ambiguous formats are blocked;
missing import providers do not prevent ordinary planner editing.

The planning worker validates the complete candidate and applies its single-use
review through one host transaction. Concurrent changes require another review;
there is no silent merge.

- [Import Center workflow, update rules and recovery](docs/IMPORTING.md)
- [Prepare context and generate planning JSON](docs/AGENT_GENERATION.md)
- [Complete annotated story example](docs/examples/planning-context.json) and
  [a complete-record update](docs/examples/planning-update.json)

## Data and ownership

The permanent add-on namespace is `dm-tools`. Its six schema-v3 collections are:

| Collection | Purpose |
| --- | --- |
| `planning_items` | Plotlines, quests, events and branches |
| `planning_flow_links` | Directed flow between siblings |
| `planning_references` | Named planning, campaign and external references |
| `planning_consequences` | Planned annotations on items or flows |
| `dm_notes` | Separate DM marginalia with shared anchors |
| `planning_views` | Card positions for each canvas |

TypeScript owns the UI; a native Go worker owns import review and commit.
The host supplies access control, schemas, transactions and persistence through
the public Add-on API v3. No host-private DOM or graph objects are used.

## Develop and package

Use Node.js 26 and the Go version in [go.mod](go.mod). The Go module's local
SDK replacement expects a compatible `ttrpg-codex` checkout beside this one.

```text
npm ci
npx playwright install chromium
npm run check
go test ./...
go vet ./...
go run ./cmd/build-package
```

The gate compiles the UI and runs unit and Chromium rendering tests. The package
command also builds the declared Windows/Linux workers and creates a checksummed
ZIP under `dist/`. Regenerate tracked `web/` and `worker/` outputs through
these commands; do not edit generated files.

From the host repository, inspect the built archive:

```text
go run ./cmd/codex-addon-inspect ../addon-dm-tools/dist/dm-tools-3.0.0.zip
```

Install through upload, inspection, permission review, approval and activation.
Source changes do not update an installed generation. Future work is tracked
only in the [suite backlog](../ttrpg-codex/docs/BACKLOG.md).
