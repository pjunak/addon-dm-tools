# DM Tools

DM Tools is the DM-only story planner and reviewed planning Import Center for
TTRPG Codex. Version 3 is a clean Add-on API v3 package:

- the interactive planner and Import Center are strict TypeScript;
- authoritative import preview and commit run in a small native Go worker;
- all campaign state uses host-managed schema-backed collections.

## Story planner

Ownership is a tree. Plotlines and quests can contain planning items; events
and branches are leaves. Every open scope is its own local directed acyclic
flow graph:

```text
Campaign
├─ Plotline
│  ├─ Quest
│  │  ├─ Event
│  │  └─ Branch
│  └─ Quest
└─ Event
```

Flow connects direct siblings only. It never changes ownership, crosses
scopes, or records what happened during play. Named references, planned
consequences, and DM notes are separate annotations and may cross scopes.

The planner supports nested navigation, card creation and editing, drag-saved
positions, explicit sibling flow, subtree deletion, and annotations. It uses
plain DOM and SVG owned by the package; no host-private graph object crosses
the add-on boundary.

## Stored contracts

The permanent add-on namespace is `dm-tools`. Six schema-v3 collections remain
stable:

| Collection | Purpose |
|---|---|
| `planning_items` | Plotlines, quests, events, and branches |
| `planning_flow_links` | Directed same-parent story flow |
| `planning_references` | Named planning/core/external references |
| `planning_consequences` | Planned annotations on items or flow |
| `dm_notes` | Separate DM marginalia |
| `planning_views` | Per-scope card positions only |

The one-time campaign converter moves old records into these same collection
IDs. There is no permanent legacy planning format or compatibility runtime.

## Import Center

DM Tools publishes and consumes `codex.import-adapter` v2. The visible center
routes a JSON document only by its top-level `format`, without naming provider
add-ons. Each provider describes its formats through the brokered serializable
service contract.

For `dm-tools-planning`, the Go worker normalizes the complete candidate,
checks hierarchy and local-flow invariants, reconciles optimistic timestamps,
and retains an opaque single-use preview token. Commit submits only those exact
reviewed mutations through one host transaction. Changes after preview cause a
conflict; there is no merge or silent overwrite.

See [Importing](docs/IMPORTING.md), [Story graph](docs/GRAPH.md), and
[Generated planning JSON](docs/AGENT_GENERATION.md).

## Develop

Use Node.js 26 and Go 1.27.1, matching the host SDK module:

```powershell
npm install
npx playwright install chromium
npm run check
go test ./...
go vet ./...
go run ./cmd/build-package
```

The one-time Playwright install provides the local Chromium used by the planner
rendering contract. CI runs the same TypeScript, Node, browser, Go, and package
checks rather than borrowing scripts or dependencies from the host checkout.

The package command builds Windows amd64, Linux amd64, and Linux arm64 workers
and creates a deterministic checksummed ZIP under `dist/`. Deployment and live
campaign conversion are performed later with the site owner present.
