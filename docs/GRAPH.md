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

The adapter uses `dagre` when links exist and `grid` for independent nodes.
Element ids are deterministic hashes of stable domain identities, keeping them
within the graph facade's length limits without exposing graph implementation
details.

## Accessible fallback and lifecycle

The route always renders a keyboard-accessible list of planning items and
named links. It remains available when the graph facade is missing or the
adapter fails. Item controls can focus nodes and expand or collapse section
detail.

Mount is scheduled only after the addon-owned route subtree exists. Re-render,
navigation, role transition, addon reload/update/disable, failed late mount,
and disposal cancel pending work and destroy the owned graph idempotently.
Generation checks prevent stale mounts from reviving disposed state.
