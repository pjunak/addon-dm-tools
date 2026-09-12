# Story graph contract

This is the implementation reference for DM Tools planning. Use the
[planner guide](PLANNER.md) for everyday tasks, the [Import Center guide](IMPORTING.md)
for review and commit behavior, and [content generation](AGENT_GENERATION.md)
for authoring JSON. Stored records use schema version 3 only.

## Ownership and flow

Ownership is a tree. Each item has a `parentId`: `null` for the campaign root,
or a plotline/quest ID. Only plotlines and quests may contain children.
An open canvas shows exactly the direct children of its scope.

Flow is a separate directed acyclic graph within each canvas. Every link has
existing endpoints and must satisfy:

~~~text
source.id != target.id
source.parentId == target.parentId
~~~

Both endpoints therefore appear together on one canvas. An `option` starts at
a branch; `continues` describes other planned progression. Cross-scope
associations use references. Never synthesize flow from ownership, references,
consequences or notes, or retarget a link to make it fit.

`planning_views` contains only positions for a scope. Moving a card cannot
change its parent or story meaning. Zoom and scroll are view-local, not stored
campaign data. Imports never carry layouts: merge preserves existing views;
replace clears them all.

The add-on owns its DOM and SVG. The host owns routing, lifecycle, authorization,
schema validation and persistence. Private host selectors, graph objects and
internal imports are outside the contract.

## Code and schema ownership

| Owner | Responsibility |
| --- | --- |
| [contracts/](../contracts/) | Closed stored-record and service schemas |
| [internal/planning/](../internal/planning/) | Authoritative import normalization and complete-dataset validation |
| [internal/importer/](../internal/importer/) | Retained preview plans and exact single-use commit |
| [planning-model.ts](../src/planning-model.ts) | Browser projection and defensive graph validation |
| [planning-repository.ts](../src/planning-repository.ts) | Browser persistence, full snapshots, guarded writes and cleanup |
| [planner-element.ts](../src/planner-element.ts) | Planner composition, forms and DOM/SVG rendering |
| [planning-reader.ts](../src/planning-reader.ts) | Reading saved prose and annotations |
| [planner-drafts.ts](../src/planner-drafts.ts) | Named draft values and opening revisions |
| [planner-selection.ts](../src/planner-selection.ts) | Canvas selection and group geometry |
| [planner-connections.ts](../src/planner-connections.ts) | Click, drag and keyboard connection gestures |
| [planner-dialog.ts](../src/planner-dialog.ts) | Shared modal focus and dismissal behavior |
| [planner-viewport.ts](../src/planner-viewport.ts) | Zoom, bounds, fit and viewport restoration |
| [planner-targets.ts](../src/planner-targets.ts) | Public target catalogs and form values |
| [planner-note-anchors.ts](../src/planner-note-anchors.ts) | Shared-note anchor selection |
| [live-refresh.ts](../src/live-refresh.ts) | Coalesced invalidations and deferred refresh |
| [dashboard-model.ts](../src/dashboard-model.ts) and [dashboard-element.ts](../src/dashboard-element.ts) | Overview projection and rendering |

Use these existing boundaries when adding behavior. The consumer must not
duplicate the import worker or move persistence into rendering helpers.

## Snapshots, writes and conflicts

Load all six collections with revision-pinned pagination. Every collection,
including an empty one, carries a host revision; subsequent pages require the
same revision. Validate stored data before allowing writes.

Every planner mutation checks all six observed collection revisions and exact
document revisions in one host transaction. An unseen child, new annotation,
incoming reference or layout edit therefore rejects the entire stale write.
Missing revisions and more than 256 mutations reject before any write. A host
that omits collection revisions cannot enable planner writes.

These guards also conflict on unrelated edits in another canvas. Keep that
behavior explicit in the UI; do not retry automatically with newer revisions.
The guards cover add-on collections, not changes to referenced core records.

For import-specific timestamps and retained review tokens, use the
[import contract](IMPORTING.md#how-the-implementation-protects-a-review).
Import commit submits the reviewed plan without reconstructing or rebasing it.

## Moving and changing items

Kind and parent changes validate the full candidate dataset before an
exact-revision write. Parent choices exclude self, descendants and leaves.
Reject a change if it would create cross-scope flow, remove a branch source
from an option, or turn a container with children into a leaf.

A move updates only the item. Child ownership, internal flow, annotations and
per-canvas positions keep their records. Its old-canvas position remains
available if the item returns. A successful move, including one discovered by
manual reload after a confirmed write, reveals the saved destination.

Store only the subtype appropriate to the chosen kind. Hidden event/branch
choices can survive draft switches, but successful saves normalize the record.
A missing draft choice remains visibly unavailable; it must not fall back
silently to the root or another target.

## Annotations and target validation

References have a named relationship, a target, an integer quantity from
1 to 1,000 and optional prose in the required `notes` field. A target is a
planning item, one of the six allowed core collections, or an explicit external
add-on/kind/record identity with a label.

The public route catalog supplies approved, role-visible core names and links.
New core/planning form targets must be selectable. Existing unavailable targets
survive unrelated edits. External targets require explicit identities; never
infer an external URL or query private host endpoints.

Consequences attach to an item or flow and may have a target of the same shape.
They are planned annotations, with no automatic world or rules effects. Flow
consequences appear at both endpoints. Clearing an optional target omits it.

Notes have up to 100 distinct, existing item anchors. An empty anchor set is
valid and remains available for relinking. Saving note links does not edit
the linked items. Hidden target fields and note selections use the same named
draft and opening-revision protections as other forms.

Dataset validation checks reference owners, planning-reference targets,
item/flow consequence anchors and note anchors. Core/external target existence
is not established by an import preview. A consequence's optional planning
target also receives shape validation rather than the reference's existence
check. Authors must verify those targets; do not claim preview validates every
narrative link.

## Deletion, undo and layout reset

Build the complete cleanup before submitting one transaction:

| Operation | Affected data |
| --- | --- |
| Delete flow | The flow and its anchored consequences |
| Delete item/subtree | Descendants, incident flows and consequences, owned/incoming planning references, affected notes and layouts |
| Delete overlapping selection | Union of selected subtrees and explicitly selected flows, without duplicate mutations |
| Reset layout | Empty positions map in the current scope's existing revision-bearing view |

Subtree cleanup removes deleted-item positions from surviving views and deletes
nested views. Shared notes retain their remaining anchors. Missing targets,
missing revisions and oversized plans fail before any write.

Deletion undo retains original affected records and exact post-transaction
revisions from the host receipt, including tombstones. It restores only the last
planner deletion during the mounted session. Validate the combined current and
restored dataset and refuse later edits to any affected record; retain unrelated
edits. Never guess tombstone revisions or silently merge note content.
A confirmed undo clears the action before its confirming read, preventing a
duplicate write after read failure. Imports do not populate this undo action.

Automatic grid positions avoid saved card bounds. Authored positions, including
deliberate overlaps, remain unchanged.

## Drafts and mutation outcomes

Drafts are view-local editor state, never campaign records or an automatic merge.
Keep each form's named values and opening revisions through selection, tab and
scope changes, reload and other saves. Clear only the confirmed submitted draft;
unrelated drafts survive. Preserve removed-record text for copying.

New items stay provisional until valid Details commit at revision zero.
Cancel and Escape discard that provisional item; links and notes require a saved
record. Scope navigation retains the provisional parent. A confirmed successful
write followed by a failed read cannot be submitted again. If the write outcome
is unknown and reload finds its ID, reconcile it as an existing draft using
its retained opening revision rather than creating a duplicate.

Failed reads or writes require explicit reload before further mutation.
Reload exposes current data without replacing draft baselines. The host's
public `edits.set` handle reports uncommitted drafts and pending writes,
including confirming reads. A host without it cannot open the editor.
Confirmed writes with failed reads are no longer unsaved changes, but unrelated
drafts still are.

The host owns navigation, sign-out and unload guards. Planner route-query
changes retain drafts; invalid targets keep an open editor. Disposal clears
the edit flags. Accepted departure or forced generation/authority teardown
discards view-local drafts and never waits indefinitely for a save.

## Selection, connections and viewport

Selection is scoped to the visible canvas and pruned after reload. Clicking
selects without opening the editor. The editor and reader share modal focus
containment, inert background controls, Escape/backdrop behavior and focus return.

Group movement snaps one displacement and preserves relative spacing, including
negative coordinates. A completed drag or keyboard move saves one view document
with all six collection guards. Cancellation or capture loss restores geometry
and the preceding selection without a write.

Connection previews are temporary SVG geometry. Completion uses the same sibling,
cycle and guarded-write checks as the flow form. Escape, cancellation, capture
loss and teardown discard the preview. Editing an existing flow preserves
endpoints and opening revisions; offered types follow the source kind even
when opened from the destination.

Zoom changes native text sizes and dimensions, rather than transforming a
rendered canvas. SVG bounds match the layout. Convert pointer movement back
through the current zoom before snapping and saving; negative coordinates
expand bounds without rewriting records. Capture the old viewport before
render replacement and restore the selected scope afterward.
Panning, fit, focus, zoom and browser fullscreen do not write campaign data.
Dispose fullscreen listeners with the stable planner element.

## Reading, navigation and lifecycle

The reader projects saved prose and annotations from the same validated dataset.
There are no separate reader records or combat state. The public
`codex-addon-markdown.source` property renders prose under the required
`ui.markdown` capability. Do not insert untrusted HTML or import host internals;
raw HTML remains text and unsafe links are inert.

Use the [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/):
initial focus on a title for long prose, keyboard containment, explicit close
and focus return. Editing from the reader uses existing draft state; closing
the editor returns to saved content. Reader expansion is separate from browser
fullscreen.

The DM-only `map.planning` contribution uses `record-context.v1` at
`map:pin:panel`. It lists items with references or item/incident-flow
consequences targeting the location. It is read-only, has loading/empty/retry
states and aborts its work when closed. It does not grant players planning access.

Routes use bounded `addon-route-context.v1` queries and validate IDs against
the loaded tree. Containers open canvases; leaves select their parent canvas
and open the reader. Scope changes update browser history. Unchanged targets
do not rebuild edited forms; invalid queries preserve an open view and its drafts.
A missing saved target falls back to the campaign canvas with an explanation.

Dashboard counts and recent links come from a validated snapshot. Each mounted
view owns its request lifetime; disconnect cancels that view's reads without
aborting the activation generation. Custom-element definitions include the
package generation so replacement cannot reuse old browser implementations.
Language changes preserve mounted drafts and record identities; authored prose
and provider diagnostics are not translated by the package.

## Live updates

Subscribe to the host's optional `data.subscribe` invalidations for all six
collections and connection/recovery resets. Without that capability, retain
manual reload. Coalesce bursts and dispose subscriptions and timers on unmount.

A clean planner reload preserves scope, selection, zoom and scroll. Readers,
active fields, drafts and gestures defer refresh with an update notice. Also
defer a read that finishes after typing or dragging begins; a late response
must not replace active work. Explicit reload keeps editor draft baselines.

Failed reads expose **Reload planner** without an automatic retry loop.
Confirmed writes consume notifications before their confirming read; events
arriving during that read remain pending. Test these boundaries when changing
refresh or save behavior, alongside the public route and rendering contracts.
