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

## Reading saved planning content

Direct links to events and branches open a shared reader; plotline/quest links
still open their canvas. Select any saved card and choose **Read selected** to
read it, or use the existing editing action/shortcuts. The reader renders the
stored summary, objective, body, setup and resolution with labels appropriate
to encounters and puzzles. References, incident story flows, item/flow
consequences and anchored shared notes use the same saved dataset. No separate
reader records or combat state exist.

**Edit item** opens the existing editor; closing it returns to the reader with
saved content. Unsaved edits remain in the planner's draft store. Escape or
**Close reader** returns focus to the selected card and preserves canvas scroll
and zoom. **Expand reader** provides more room without browser fullscreen.
Automatic refresh waits while reading; an update notice and **Reload planner**
let the DM choose when to replace the saved snapshot. Explicit reload preserves
editor drafts and detects deleted items.

The reader follows [W3C's modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/):
initial focus on the title for long prose, keyboard containment, an explicit
close action and focus return. Native dialog presentation and existing mobile
layout are shared with the editor.

Require the host's `ui.markdown` capability. Prose is assigned to the public
integrated `codex-addon-markdown.source` property; the package neither imports
host internals nor inserts untrusted HTML. Raw HTML remains text and unsafe
links are inert. Core references use the route's approved role-visible catalog.

The DM-only `map.planning` slot uses `record-context.v1` at `map:pin:panel`.
It lists planning items with a reference or item/incident-flow consequence
targeting that location. Links open the reader for leaves and canvas for
containers. This panel is read-only, subscribes to the existing repository and
does not grant players access to private planning data. Empty, loading and
retry states are explicit; leaving the panel aborts its work.

Item kind/parent changes use the same full-dataset validation as other planner
edits, followed by an exact-revision write guarded by all six collection
revisions. The parent selector excludes self, descendants, and leaf items.
A move updates only that item: child ownership, internal flows, annotations,
and per-canvas positions retain their records. Positions in the old canvas
remain available if the item returns. Cross-scope incident flows, an option
flow losing its branch source, or a container with children becoming a leaf
reject the edit before writing. The planner does not infer replacement links
or delete annotations to make a move possible.

Kind changes store only their relevant event/branch subtype. Hidden subtype
choices survive view-local draft switches, while successful saves normalize
the record to its chosen kind. Missing draft options remain explicit unavailable
choices rather than falling back to the root. A successful move and a manual
reload after a confirmed move both reveal the saved destination.

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

The mounted contribution's public `edits.set` handle reports whether any
uncommitted draft remains and whether a write (including its confirming read)
is pending. The host owns navigation, sign-out, and browser-unload guards. The
planner opts into retaining drafts across its route queries and keeps the open
editor on invalid query targets. Confirmed writes whose read failed are not
reported as unsaved, but unrelated drafts still are. A host without this handle
cannot open the editor. Disposal clears its flags; forced generation/authority
teardown never waits for a save or persists drafts.

Pointer cancellation or capture loss restores the card's original coordinates;
only a completed pointer release persists a moved position.

`planner-selection.ts` owns pointer/keyboard selection and gesture-local geometry.
Item and flow selections are scoped to the visible canvas and pruned after reload.
Clicking selects without opening a form; the editor is a separate modal with
Details, Links and Notes panels. Closing or switching panels preserves named
drafts and their opening revisions. The dialog bounds keyboard focus and makes
background planner controls inert until closed.

A group drag snaps its displacement, preserving the cards' relative positions,
including negative coordinates. Completed group drags and keyboard moves update
one `planning_views` document through the repository with all six collection
guards. Canceled gestures restore both geometry and the preceding selection.
Group deletion unions overlapping subtrees and explicitly selected flows before
building the existing cross-collection cleanup; missing targets, missing
revisions and oversized deletion plans reject before any write.

New items remain provisional in the mounted planner until their Details form
passes validation and commits at revision zero. Cancel and Escape clear only
that draft. Links and notes are unavailable before creation. A known successful
write followed by a failed read cannot be submitted again; an unknown outcome
that reload finds by ID becomes an existing draft retaining its opening revision.
Scope navigation retains the provisional item without changing its parent.

Deletion undo captures the original affected records and exact post-transaction
revisions from the host receipt, including tombstones. The last deletion can be
restored in one guarded transaction during the mounted planner session. Undo
validates the combined current/restored dataset and refuses later edits to any
affected record; unrelated edits are retained. It never guesses a tombstone's
revision or silently merges shared-note content. A confirmed undo clears its
action before the confirming read, preventing a duplicate write after read failure.
Resetting a layout writes an empty positions map for the current scope and keeps
its revision-bearing view, so the next drag can update it normally.
Automatic grid positions for new or unpositioned cards avoid saved card bounds;
authored positions, including deliberately overlapping cards, are unchanged.

`planner-connections.ts` owns click, drag and keyboard connection gestures. Its
preview is view-local SVG geometry at the current native zoom. Completion uses
the same sibling/cycle validation and guarded repository write as the flow
form. Pending connections defer live refresh; Escape, pointer cancellation,
capture loss and teardown discard the preview without writing. Dialogs share
focus containment and backdrop/Escape handling through `planner-dialog.ts`.

`planner-viewport.ts` owns the preserved fixed zoom ladder, fit calculation,
content bounds and device-pixel rounding. Zoom changes native dimensions and
text sizes, never a transform of the rendered canvas. SVG uses matching logical
bounds; pointer movement is divided by the current zoom before snapping and
saving. Negative coordinates expand the view bounds without rewriting records.
Zoom/scroll are view-local and separate for each scope; rendering captures the
old viewport before replacement and restores the selected scope after mounting.
Fullscreen uses the browser API on the stable planner element and disposes its
listener with the element. Panning, fit, focus and zoom do not write campaign data.

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

`planner-targets.ts` validates the public route reference catalog and target
form values. The manifest requests read access only to the six core collections
accepted by the planning target schema. The host supplies role-visible names
and links; the package never queries host-private endpoints or DOM. Saved
unavailable targets are retained on unrelated edits, while new core/planning
targets must be selectable. External targets require explicit add-on, kind,
record ID and label; no external URL is inferred. Consequences can clear their
optional target. Reference quantity is an integer from 1 to 1,000.

`planner-note-anchors.ts` exposes note anchors as a bounded checkbox list backed
by one named draft value. Duplicate, missing or more than 100 anchors fail
before writing. An empty anchor set is valid: those notes appear with an
unanchored notice in the selected item's annotations and can be linked again.
Saving links never changes the referenced items. Target switches retain hidden
field drafts, and all annotation writes retain exact opening revisions and
the six collection guards.

The repository subscribes to the host's optional `data.subscribe` invalidations
for all six planning collections and connection/recovery resets. Planner and
dashboard coalesce bursts and dispose subscriptions/timers when unmounted.
Older hosts retain manual reload. A clean planner reload preserves scope,
selection, zoom and scroll position. Active fields, drafts and pointer gestures
defer refresh with an English/Czech notice. A read that finishes after typing or
a drag began is also deferred. Reload never replaces a draft's opening revision;
stale saves still fail atomically. Failed reads expose the existing Reload path
without starting an automatic retry loop. Confirmed writes consume notifications
before their post-save read; events received during that read remain pending.
