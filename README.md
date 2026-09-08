# DM Tools

DM Tools is the DM-only story planner and reviewed planning Import Center for
TTRPG Codex. Version 3 is a clean Add-on API v3 package:

- the interactive planner and Import Center are strict TypeScript;
- authoritative import preview and commit run in a small native Go worker;
- all campaign state uses host-managed schema-backed collections.

## Story planner

The DM panel includes the original planning overview: total items, plotlines,
quests, encounters and marginalia, links to the planner and Import Center, and
the twelve most recently changed items. It follows the host's English/Czech
language and dark/gold presentation. Counts reload on entry, **Refresh
overview**, and live planning changes, including completed imports. Failed reads retain tool links and a retry; unavailable import
providers do not prevent direct planning edits. Import availability follows
advertised formats, independently of provider add-on IDs.

The browser explicitly includes its own planning worker in service discovery;
worker startup keeps its normal dependency rules. Actual installed-package checks
cover planning preview, cancellation, single-use commit, concurrent-edit conflicts
and generation replacement. Broader presentation and workflow parity remain in
the suite [backlog](../ttrpg-codex/docs/BACKLOG.md).

The Import Center restores the file chooser and document/provider review layout.
Choose or drop one JSON file, review its changes and warnings, then commit the
exact plan. English/Czech controls include cancellation and provider discovery
retry. Independent import providers share the chooser through their declared
formats; ambiguous formats stay blocked. See [reviewed imports](docs/IMPORTING.md).

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

Canvas controls restore the fixed 35–200% zoom ladder with a native 100% stop,
**Fit**, **Focus selected**, and browser fullscreen. Drag empty canvas to pan,
or focus it and use arrow keys. Ctrl/Command + wheel and +/− zoom; 0 resets and
F fits. Each canvas keeps its zoom and scroll position while the planner stays
open, including selection, refresh, saved changes and navigation to another
canvas. Zoom lays out native text and geometry directly. Card drags convert
screen movement back to saved coordinates, and distant or negative saved
positions remain reachable. Controls follow the host's English/Czech language.

The original **Kind** and **Parent** controls are available in item details.
Move an item to the campaign root or another plotline/quest, or change its kind;
the matching event/branch subtype field follows the selection. Parent choices
exclude the item itself, its descendants, and leaf items. Moving a container
keeps its children and their internal flow, references, consequences, notes,
and saved canvas layouts. The editor follows the moved item to its destination.
Existing flows that would cross canvases, option flows that would lose their
branch source, and children of a proposed leaf prevent saving with an
explanation. Review those relationships before changing the structure.

Flow labels and direction are visible on the canvas. **Edit flow** changes the
label and type from either endpoint; option flow is offered only for a branch
source. Consequences may apply to the whole item or one of its flows, and
flow consequences appear at both endpoints. Removing a flow with consequences
asks for confirmation and deletes the flow and those consequences in one
revision-checked transaction. Whole-item consequences and endpoint records stay
intact. Subtree deletion also cleans incoming planning references and saved
positions, while shared notes retain their remaining anchors.

**Add reference** chooses a planning item, visible campaign record, or explicit
external add-on record. Saved references expose their name, relation, quantity
(1–1,000), target, and notes. Campaign choices use the host's approved read
grants; unavailable saved targets remain visible and survive unrelated edits.
Consequences optionally target the same kinds of records. **Linked planning
items** shares a DM note across items or removes its links. Unanchored notes
remain available in the annotations of any selected item so they can be linked
again. New-reference choices and note links share the regular draft protections.

Item details include the original objective, setup, resolution, tags, and
event/branch type fields. Item, annotation, and new-flow drafts survive card
selection, canvas navigation, other saves, validation errors, and explicit
planner refresh while the planner stays open. Each edit keeps its opening
revision; a refresh never silently rebases a draft over another saved change.
**Discard edits** loads that record's latest fetched values. Drafts of removed
records remain available to copy before discarding.
If a draft's parent choice disappears during refresh, it remains visibly
unavailable until you choose a valid parent or discard the edit.

Writes lock the form until their outcome is known. After a write/read failure,
**Reload planner** is required before further editing; retained text stays
available to copy. A confirmed write followed by a failed refresh is not
offered again. Canceled pointer drags restore the original position without a
write. The planner uses the host's classic theme tokens and keeps card text at
native scale. Leaving the planner or signing out asks before discarding drafts;
browser reload/close uses the host's unsaved-edit warning. Saves in progress
block navigation until their outcome is known. Canceling keeps the current
view and all its drafts; confirming discards them. Drafts are not persisted
across an accepted reload or forced package/authority teardown. Broader
interaction parity and full localization remain in the suite backlog.

Planner canvas links use `#/addons/dm-tools/planner?item=<id>`. Containers open
their own canvas; events and branches open their parent and select the linked
item. Reload, a new tab and browser Back retain that target. Invalid parameters
retain an already open planner and its drafts, or show a recovery link on first
entry; a deleted target falls back to the campaign canvas with
an explanation. An unchanged route-context refresh preserves editor input.

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
