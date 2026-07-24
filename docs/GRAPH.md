# Scenario graph

DM Tools registers the effective-DM-only route `#/dm-scenarios`. It consumes
the host's `graphs.facade` API version 1 with permission `ui:graph`; it never
imports Cytoscape or reads a browser graph-library global.

## Mapping

The stored scenario schema has no relationship field. The graph therefore
uses the smallest deterministic mapping that does not invent campaign
semantics:

- each valid scenario becomes one node with `id`, `name` as its label, and
  `status` as its kind;
- nodes sort by `planned`, `active`, `completed`, then English name and id;
- the edge list is empty;
- the host `grid` layout arranges the independent nodes.

The view does not persist graph positions, create planner state, infer edges
from tags or timestamps, or modify scenarios. If a later schema explicitly
defines relationships, that is a separate versioned data-model change.

## Rendering and lifecycle

The page renders accessible loading, empty, unavailable-facade, adapter-error,
and effective-player-denial states in English and Czech. The scenario list is
the keyboard-accessible companion to the interactive canvas. Dynamic scenario
names and summaries pass through `host.h.esc`; graph labels remain plain text
inside the host adapter.

Mount is scheduled only after the addon-owned route subtree exists. Repeated
render cancels pending work and destroys the previous handle. Navigation away,
view-as transitions, addon reload/update/disable, failed late mounts, and addon
disposal all destroy the owned graph idempotently. The host facade performs a
second ownership and lifecycle check, so stale scheduled work cannot revive a
disposed graph.
