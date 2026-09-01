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
