# Story canvas

DM Tools owns one effective-DM-only route family under `#/dm-plans`. The canvas
is an addon-owned DOM/SVG workbench built from public host helpers, actions, and
design tokens. It does not access Cytoscape or any host-private graph object.
The generic host graph facade remains available to other addons but is not a
good fit for rich planner cards, marginalia markers, nested scopes, and
dedicated detail screens.

## Projection

An open canvas represents exactly one scope:

- no id: the campaign root;
- a plotline id: that plotline;
- a quest id: that quest.

Only direct children of the scope become cards. Ownership is never drawn as an
edge; it is expressed by entering the child canvas and by breadcrumbs.
Plotlines and quests may contain children. Events and branches are leaves.

Stored flow links are projected separately. For a cross-scope endpoint, the
projection walks upward until it reaches the visible direct child. A link whose
two endpoints roll up to the same card is internal to that card and is hidden
until the DM enters it. No edge is inferred from ownership, tags, text, time,
position, references, or consequences.

## Interaction

- Single click or Space selects a card and updates the inspector in place.
  This deliberately avoids a route rerender and preserves canvas scroll.
- Double-click or Enter enters a plotline/quest or opens a dedicated
  encounter/puzzle screen.
- Pointer drag moves a card, snaps to the 24 px grid, and stores its position.
- Dragging from the circular edge handle to another card creates a flow link.
  Clicking the handle and then a target provides a second pointer path.
- The inspector provides labelled native forms for keyboard-only creation and
  editing of flow, references, consequences, and marginalia.

The canvas uses one route and one active scope rather than expandable compound
nodes. Deeply nested quests therefore remain focused and readable.

## Visual conventions

| Meaning | Convention |
|---|---|
| Plotline | heavy gold border |
| Quest | blue border |
| Story event | neutral event card |
| Encounter | danger border; dedicated detail screen |
| Puzzle | mystery border; dedicated detail screen |
| Decision / condition / random branch | dashed gold border |
| Normal flow | solid directed orthogonal line |
| Branch option | dashed gold directed line |
| Rolled-up cross-scope flow | subdued dashed line |
| Linked DM note | notebook marker in the card corner |

Line geometry uses right angles with rounded corners. `planning_views` stores
only `{x,y}` positions per scope:

```json
{
  "id": "scope-quest-earthquake",
  "schemaVersion": 2,
  "scopeId": "quest-earthquake",
  "positions": {
    "event-tremor": { "x": 72, "y": 72 }
  },
  "updatedAt": 1785000000000
}
```

Auto-arrange removes that scope record and cannot change story meaning.
Imported documents never contain view records.

## Lifecycle and accessibility

Every card is keyboard-focusable and has a plain-text accessible label.
Connection, CRUD, and detail operations remain available through native form
controls without drag gestures. The inspector, breadcrumbs, badges, and
announcements use host components and localization.

Each render removes the previous pointer/keyboard listeners and cancels a
pending mount. Navigation away, role changes, addon replacement, and disposal
perform the same cleanup. Selection alone does not remount the canvas.
On the desktop split view, the workbench owns a viewport-bounded height and the
inspector scrolls independently, so long selected-item content cannot stretch
the stage or push the canvas below its toolbar. The stacked layout returns to
normal document flow.
