# Story graph contract

The planner is a tree of local directed acyclic graphs.

Ownership provides scope: campaign root, plotline, or quest. An open canvas
shows exactly the items whose `parentId` equals that scope ID. Plotlines and
quests may own children; events and branches are leaves.

Flow is separate from ownership. Every stored link must satisfy:

```text
source.id != target.id
source.parentId == target.parentId
```

Both endpoints therefore appear together on exactly one canvas. `option` flow
must start at a branch. The combined local flow remains acyclic. Cross-scope
relationships use named references, not synthesized or retargeted edges.

The TypeScript UI renders direct children as draggable cards and real local
flow as SVG paths. `planning_views` stores only per-scope `{x,y}` positions;
moving a card cannot change planning meaning. Deleting an item explicitly
deletes its subtree and attached flow, annotations, notes, and nested layouts
in one transaction.

The package owns its DOM and SVG. The host owns route mounting, lifecycle,
authorization, schema validation, and persistence. No private graph library or
host DOM selector is part of the contract.

`dashboard-model.ts` projects counts and recent-item links from a validated
repository snapshot. `dashboard-element.ts` owns only its view request;
disconnect cancels reads without aborting the activation generation. The
planner uses the bounded public `addon-route-context.v1` query to choose a
scope/selection, never to grant record access. Route targets are checked against
the loaded item tree. Unchanged targets do not re-render an edited form, while
scope changes update the URL so browser history and copied links remain useful.
Element definitions include the package generation so replacement cannot reuse
an older generation's browser implementation.

`planner-drafts.ts` keeps view-local named form values and their opening record
revisions. Only the confirmed submitted draft is cleared after a successful
read; unrelated drafts survive. Failed writes or reads require an explicit
refresh before another mutation. Refresh preserves opening revisions, exposes
concurrent changes, and retains removed-record drafts for copying. This is
local editor state, never campaign data or an automatic conflict merge.

Pointer cancellation or capture loss restores the card's original coordinates;
only a completed pointer release persists a moved position.

Flow editing preserves endpoints and opening revisions. Available types follow
the source item's kind, including when editing from the destination. Flow
labels use native SVG text; paths show arrowheads for direction. Consequences
can switch between the selected item and its attached flows. Existing flow
consequences are visible from either endpoint.

The repository builds flow/subtree cleanup before issuing one transaction.
Deleting a flow removes its anchored consequences. Subtree deletion additionally
removes incoming planning references and deleted-item positions in surviving
views, and trims shared-note anchors. Missing revisions and plans over the
256-operation host limit fail before any write. Browser snapshot validation now
checks reference ownership/targets and note/consequence anchors against the
same rules as the Go dataset validator.

Every loaded collection carries its host revision, including empty collections.
Subsequent pages require the same revision. Every planner mutation checks all
six observed collection revisions atomically, alongside the exact document
revisions. An unseen child, annotation, reference, layout change, or simultaneous
flow edit therefore rejects the entire stale write. The editor retains drafts
and requires Reload; it does not automatically retry with newer revisions.
This deliberately also conflicts on unrelated edits in another planner view.
Hosts that omit collection revisions cannot enable planner writes. These guards
cover add-on collections, not changes to core records referenced by the planner.
