# Story canvas

DM Tools owns one effective-DM-only route family under `#/dm-plans`. The canvas
is an addon-owned DOM/SVG workbench built from public host helpers, actions, and
design tokens. It does not access Cytoscape or any host-private graph object.
The generic host graph facade remains available to other addons but is not a
good fit for rich planner cards, marginalia markers, nested scopes, and
dedicated detail screens.

## Model: a tree of local DAGs

Ownership forms a tree. Flow does not form one campaign-wide graph; each
campaign, plotline, or quest scope owns a separate directed acyclic graph over
its direct children.

For every stored flow link:

```text
source.parentId === target.parentId
```

`null === null` makes campaign-root links valid. Equal nesting depth is not
enough: children of different quests are on different canvases and cannot share
a flow link. Named references and consequence targets are separate semantic
relationships and may cross scopes.

## Scope and projection

An open canvas represents exactly one scope:

- no id: the campaign root;
- a plotline id: that plotline;
- a quest id: that quest.

Only direct children of the scope become cards. Ownership is never drawn as an
edge; it is expressed by entering the child canvas and by breadcrumbs.
Plotlines and quests may contain children. Events and branches are leaves.

Stored flow links connect only direct siblings with the same immediate parent.
Each link is therefore rendered on exactly one canvas with both real endpoints
visible. Invalid or incomplete records are ignored defensively by projection.
No edge is inferred from ownership, nested content, tags, text, time, position,
references, or consequences.

### Transitions between nested plans

Represent a cross-plan handoff at the nearest shared canvas. If an internal
event in Quest A leads into Quest B, end Quest A's internal flow locally and
connect `Quest A → Quest B` on their parent canvas. The planner deliberately
does not preserve an exact cross-scope chronological endpoint. Use a named
reference when the precise relationship matters but is not story flow.

## Interaction

- The Atlas dock is both the creation palette and visual legend. Each tool uses
  the same shape, border color, and line treatment as the card it creates.
  Clicking creates at the visible center; dragging creates at the drop point.
  Creation immediately persists a valid placeholder without opening the edit
  dialog, so a DM can lay out several cards before filling them in. Cards with
  no planning detail use a subtle drafting hatch and a **Needs details** badge.
- Single click or Space selects a card. Shift-click toggles membership and a
  drag on empty canvas creates a marquee selection. Selection updates card and
  edge styling plus the contextual toolbar without remounting the canvas, so
  scroll is preserved.
- Double-click or Enter edits one card in a modal. Shift+Enter, or the explicit
  contextual action, enters a plotline/quest or opens an encounter/puzzle.
- Pointer drag moves every selected card as a group, snaps to the 24 px grid,
  and stores the changed positions in one view update. Arrow keys move the
  selection by one grid step; Shift+Arrow moves it by four.
- Dragging from the circular edge handle to another card creates a flow link.
  Clicking the handle and then a target, or pressing C and choosing a target,
  provides equivalent paths.
- Flow lines are focusable and selectable. Delete removes selected lines
  immediately; deleting cards confirms the semantic subtree cleanup. The most
  recent deletion can be restored with Undo or Ctrl/Cmd+Z.
- The editing modal provides labelled native forms under Details,
  Links & consequences, and Notes tabs. Save and Cancel remain in its fixed
  header while the form body scrolls. Flow target controls list siblings from
  the active canvas only.
- Moving an item to another owner is rejected while any attached flow would be
  left on a different canvas. The DM must remove those links explicitly; the
  planner never deletes or retargets them as a side effect.
- Deleting a populated plotline or quest requires explicit confirmation and
  atomically removes its planning subtree and attached planner data. Named
  campaign targets such as people and places are references and remain intact.

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
| Linked DM note | notebook marker in the card corner |

Line geometry uses right angles with rounded corners. `planning_views` stores
only `{x,y}` positions per scope:

```json
{
  "id": "scope-quest-earthquake",
  "schemaVersion": 3,
  "scopeId": "quest-earthquake",
  "positions": {
    "event-tremor": { "x": 72, "y": 72 }
  },
  "updatedAt": 1785000000000
}
```

Auto-arrange removes that scope record and cannot change story meaning.
Imported documents never contain view records. Only schema-version-3 view
records are read; older layouts are ignored rather than converted.

## Lifecycle and accessibility

Every card and flow line is keyboard-focusable and has a plain-text accessible
label. Connection, CRUD, selection, and detail operations remain available
without drag gestures. The modal, breadcrumbs, badges, shortcut reference, and
announcements use host components or tokens and localization.

Each render removes the previous pointer/keyboard listeners and cancels a
pending mount. Navigation away, role changes, addon replacement, and disposal
perform the same cleanup. Selection alone does not remount the canvas. On
desktop the Atlas is a narrow left rail and the workbench owns a
viewport-bounded height. On narrow screens the Atlas becomes a horizontally
scrollable tool shelf while the editor modal becomes a bottom sheet.
