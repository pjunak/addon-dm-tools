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
- The top-right fullscreen control uses the browser Fullscreen API to expand
  the workbench across the physical display, including the space normally used
  by browser chrome. The same control returns it to the normal layout. In
  fullscreen, view and arrangement controls live in a top drawer while the
  Atlas and selection actions remain in a bottom drawer. Only their gold edges
  remain visible until the pointer enters the approximately 18 px top or bottom
  reveal zone, a control receives keyboard focus, or an Atlas tool is dragged.
  Escape also exits fullscreen after any open modal or connection gesture has
  been dismissed.
- The stage controls use the fixed 35%, 45%, 55%, 60%, 70%, 80%, 90%, 100%,
  110%, 125%, 150%, 175%, and 200% zoom ladder. Buttons and scroll-wheel input
  step through the same values. Large mouse-wheel deltas are limited to one
  step per browser event while small trackpad deltas accumulate. Reset selects
  exactly 100%, and a batched step cannot cross 100% without stopping there.
  The story position under the pointer remains stationary. Any non-ladder value
  is normalized to its nearest level. Each scope keeps its zoom for the
  current planner session; it is intentionally not campaign content. Card
  geometry follows every zoom change. Typography uses explicit integer-pixel
  bands at 35–60%, above 60–80%, above 80–100%, above 100–125%, above
  125–150%, above 150–175%, and above 175–200%. The first band is the minimum:
  zooming below 60% changes card geometry and line breaks without shrinking the
  title below 15 px or body text below 10 px. The text-bearing canvas is never
  compositor-scaled, so browsers rasterize every band at its real font size.
  Rendered card origins, width, padding, borders, and text-adjacent spacing snap
  to the current display's physical-pixel grid; stored graph coordinates remain
  continuous so this rendering concern cannot affect routing or drag storage.
- Semantic detail changes independently from typography. Below 100% the
  condensed level hides metadata, marginalia, and flow-label text; below 60%
  compact also hides summaries; below 45% overview hides kind labels and keeps
  only titles. A description therefore remains visible at exactly 60%. Rows
  removed by a semantic level do not reserve empty card height; detail changes
  occur only at discrete thresholds, and actual card bounds drive connector
  geometry after both row removal and Pretext wrapping change the height.
- The stage bar labels Story Planner as an **editable canvas**, distinguishing
  it from derived read-only projections such as Mind Palace. Its zoom control
  uses the same minus / exact percentage / plus / Fit presentation as Mind
  Palace. Fit selects the largest fixed ladder level that contains the active
  structure, never enlarges beyond 100%, and centers it without changing stored
  graph positions.
- Whenever semantic zoom removes information, a visible status pill names the
  hidden layers. Overview reports hidden types, descriptions, metadata, notes,
  and flow labels; compact restores types; condensed restores descriptions.
  The indicator disappears at 100%, where all planning detail is visible.
- Holding the middle mouse button and dragging pans the viewport in either
  standard or fullscreen mode, matching the established CAD interaction. It
  does not alter selection or card positions and shows a grabbing cursor while
  active. A 480 px working margin surrounds the rendered plan and the initial
  viewport starts at that margin, so even an empty canvas can pan in every
  direction instead of being clamped at its origin.
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
only `{x,y}` positions per scope; fullscreen and zoom are transient UI state:

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

Card titles, summaries, and flow labels borrow `host.h.layoutText`, backed by
Pretext. The planner owns the role-specific font descriptors, available width,
line caps, ellipsis policy, and semantic levels; the host owns Unicode-aware
measurement and caching. Returned line strings are rendered verbatim, and an
older host falls back to native browser wrapping instead of blocking the
planner. `story-planner-rendering.js` is the single owner of typography bands,
snapped card metrics, and their CSS-variable projection; label, render, and
interaction modules only consume that contract. Flow labels still choose the
longest usable straight connector segment and rotate with a vertical segment.
Their graph-space font descriptor
counterbalances SVG viewport scaling so the visible font follows the same
integer typography bands. Card widths are measured from the same device-pixel-
snapped geometry exposed to CSS, and flow widths retain a stable half-pixel
bucket. DOM children change only when the materialized lines change. The
mounted canvas borrows the host's optional invalidation subscription and
releases it with its other route-owned listeners, so a zoom-band change, late
font loading, or locale change refreshes card and flow breaks without giving
the addon ownership of the text engine.

## Lifecycle and accessibility

Every card and flow line is keyboard-focusable and has a plain-text accessible
label. Connection, CRUD, selection, and detail operations remain available
without drag gestures. The modal, breadcrumbs, badges, shortcut reference, and
announcements use host components or tokens and localization. Zoom controls
report their exact percentage, and fullscreen is an accessible pressed-state
toggle with localized enter and exit labels.

Each render removes the previous pointer/keyboard listeners and cancels a
pending mount. Navigation away, role changes, addon replacement, and disposal
perform the same cleanup. Selection alone does not remount the canvas. On
desktop the Atlas is a narrow left rail and the workbench owns a
viewport-bounded height. On narrow screens the Atlas becomes a horizontally
scrollable tool shelf while the editor modal becomes a bottom sheet.
