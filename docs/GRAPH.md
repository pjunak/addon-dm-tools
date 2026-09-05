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
