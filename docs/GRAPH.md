# Planning graph

DM Tools registers the effective-DM-only route `#/dm-scenarios`. The stable
route is retained from the earlier scenario graph, but the page now projects
the complete planning model through host `graphs.facade` API version 1.
DM Tools never imports Cytoscape or exposes raw graph-library objects.

## Projection

- Every planning item becomes a node whose kind reflects `thread`, `quest`,
  `scenario`, `encounter`, or `note`.
- Collapsed items hide their section nodes.
- Expanded items add their named sections and explicit item-to-section
  containment edges.
- Core and external-addon nodes appear only when a stored link references
  them.
- Every `planning_links` record becomes exactly one edge. Its custom `name` is the edge
  label; its fixed relation `type` remains available in stored data.
- No edges are inferred from folders, tags, state, time, prose, or proximity.

A section endpoint is resolved according to view state:

```text
NPC ──"Requests a discreet investigation"──> Quest / Audience with the Duke
```

When the quest is collapsed, the same stored edge targets the quest node. When
expanded, it targets the named section node. The label and link identity do not
change.

The workbench uses the facade's validated `preset` layout when the host
advertises `node-position` and `node-drag`. New or unplaced nodes receive a
deterministic three-lane arrangement: world references, planning items, and
expanded sections. Element ids are deterministic hashes of stable domain
identities, keeping them within the graph facade's length limits without
exposing graph implementation details.

## Editing and view state

Selecting a node opens a persistent inspector. Planning items and sections can
create explicit named connections to another planning item or section from
that inspector; the full planning workspace remains the edit surface for item
prose and world/external references. Existing related links can be reviewed
and deleted in either surface.

Drag completion stores a bounded `{x,y}` value under the stable endpoint
identity in the keyed DM-only `planning_views` collection. The single
`campaign-map` record is presentation state only:

```json
{
  "id": "campaign-map",
  "schemaVersion": 1,
  "positions": {
    "planning:quest-sigil": { "x": 120, "y": 80 }
  },
  "updatedAt": 1785000000000
}
```

It is deliberately outside `planning_items`, `planning_links`, and the import
schema. Auto-arrange deletes this view record and cannot change campaign
meaning. An older compatible graph implementation without the optional drag
features remains a read-only dagre/grid projection.

## Accessible fallback and lifecycle

The route always renders a keyboard-accessible list of planning items. It
remains available when the graph facade is missing or the adapter fails. Item
controls can focus nodes and expand or collapse section detail. The selected
node inspector and connection form use labelled native controls and do not
depend on pointer dragging.

Mount is scheduled only after the addon-owned route subtree exists. Re-render,
navigation, role transition, addon reload/update/disable, failed late mount,
and disposal cancel pending work and destroy the owned graph idempotently.
Generation checks prevent stale mounts from reviving disposed state.
