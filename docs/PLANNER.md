# Using the story planner

Use the planner to prepare a campaign, explore possible paths and keep related
DM notes together. It is private to the DM. Planned flow describes what could
happen; it does not record completed sessions or apply rules and rewards.

For bringing in prepared JSON, use the [Import Center](IMPORTING.md).
For writing that JSON yourself or with an agent, use the
[content-generation guide](AGENT_GENERATION.md).

## Start a story

1. Open the planner from the DM overview.
2. Create a plotline for the larger arc, or a quest for a specific objective.
   Give it a recognizable title and a short summary, then choose **Save item**.
3. Open that plotline or quest to work on its canvas. Add scenes and branches
   as children.
4. Connect possible progressions between cards on that canvas.
5. Add references, possible consequences and shared notes where they help you
   run the story. Use **Read selected** to read the saved material.

New cards stay unsaved until **Save item** succeeds. **Cancel creation** or
Escape discards a new card without leaving a placeholder. Links and notes
become available after the card is saved. Moving to another canvas keeps an
unfinished new card under **Resume new item**, with its original parent.

## Choose the right kind of item

| Item | Purpose | Can contain children? |
| --- | --- | --- |
| Plotline | A larger story arc | Yes |
| Quest | An objective with its own preparation and scenes | Yes |
| Event | A story scene, encounter or puzzle | No |
| Branch | A decision, condition or random fork | No |

Each canvas shows one container's direct children, or the campaign's root items.
The tree describes where material belongs:

~~~text
Campaign
└─ Plotline: The missing courier
   ├─ Quest: Find the courier
   │  ├─ Event: At the broken bridge
   │  ├─ Branch: How will they cross?
   │  ├─ Event: Ask the ferryman
   │  └─ Event: Make a safe crossing
   └─ Quest: Recover the message
~~~

The two quests can have flow between them. Inside the first quest, the arrival
can lead to the branch, and the branch can offer the ferry and repair options.
A quest cannot have a flow to its own child. Use a **reference** for an
association between different canvases.

Flow cannot loop back into a cycle. If the story may revisit a place, describe
that possibility in prose or model a distinct later scene. A flow arrow is
preparation, not a history of the party's movement.

## Read and edit saved content

Select a card and choose **Read selected** for its formatted summary, objective,
body, setup, resolution, references, flow, consequences and shared notes.
**Expand reader** gives long material more room. Direct links to events and
branches open this reader; links to plotlines and quests open their canvases.
The read-only planning list on a map location uses the same links.

Choose **Edit item** from the reader, or double-click a card on the canvas.
The editor has **Details**, **Links** and **Notes** tabs, with **Save item** in
its header. On phones it appears as a bottom sheet. Closing or switching tabs
retains existing-record drafts; closing an unsaved new-card editor cancels
that creation. Closing the editor returns to saved content if the reader is
open. Closing the reader restores focus and the canvas view.

Use objective for what the characters can accomplish, setup for preparation,
body for detailed material, and resolution for possible outcomes. Event and
branch subtypes keep encounters, puzzles and different kinds of fork distinct.
The [generation guide](AGENT_GENERATION.md#turn-the-story-into-records) gives
more writing guidance.

Controls follow the host's English or Czech language. Changing the language
keeps the open draft; authored titles and prose remain in their original language.

## Connect and rearrange the story

Click a card's connection port, then another card, or drag between the ports.
A branch starts an option flow; other cards start a continuing flow. You can
also select two cards and choose **Connect selected**. Escape cancels a pending
connection without saving it. Invalid endpoints or cycles are rejected.

Select an existing flow to edit it, or use **Edit flow** from either endpoint.
You can change its label and type; changing an option to a continuing flow does
not change its endpoints. Labels and arrowheads show the planned direction.
Removing a flow reviews and removes its attached consequences in the same
operation; endpoint cards and whole-item consequences remain.

Change **Kind** or **Parent** in item details to reorganize the tree. Only
plotlines and quests are valid parents, and an item cannot become its own
ancestor. Moving a container keeps its children, their internal flow and
annotations. After saving, the editor follows the item to its destination.

A move or kind change can be blocked by existing relationships: a flow would
cross canvases, an option would lose its branch source, or a container with
children would become a leaf. Review those relationships first; the planner
does not silently remove them to make the change fit.

## Add references, consequences and notes

| Annotation | How to use it |
| --- | --- |
| Reference | Name a related planning item, visible campaign record or explicit external add-on record. Set the relationship, quantity and any notes. |
| Consequence | Describe a possible world change, reward, information or complication on an item or one of its flows. An optional target identifies what it concerns. |
| DM note | Keep preparation or marginalia separate from the item. Use **Linked planning items** to share it across cards. |

A consequence is descriptive: it never grants an item, changes a character
sheet or marks an outcome as completed. Flow consequences appear at both
endpoints. Reference quantity is an integer from 1 to 1,000.

Unavailable saved targets remain visible and survive unrelated edits. New
campaign choices come from the records the host permits you to read. An
external reference needs an explicit add-on, record kind, ID and readable name.

Removing all links from a note keeps the note. Unanchored notes remain available
in a selected item's annotations so you can link them again.

## Move around the canvas

Click a card or flow to select it; Shift-click adds or removes a selection.
Drag empty canvas to select a rectangle. Drag selected cards together to keep
their spacing. Moving cards changes the layout, not ownership or story flow.

Use **Fit**, **Focus selected** and fullscreen for larger plans. Zoom ranges
from 35% to 200%, including 100%. Each canvas retains its zoom and scroll while
the planner stays mounted. Panning and zooming do not save campaign changes.
Touch scrolling on empty canvas uses normal browser scrolling.

| Action | Keyboard or pointer |
| --- | --- |
| Select all visible cards | Ctrl/Command+A |
| Edit selected card | Enter or double-click |
| Open selected plotline/quest | Shift+Enter |
| Move selected cards | Arrow keys; Shift moves four grid steps |
| Pan | Middle-drag, Alt-drag or Ctrl/Command+arrow keys |
| Start a connection | C with a card selected; Enter on the focused target completes it |
| Zoom | Ctrl/Command+wheel, or +/− |
| Reset zoom / fit | 0 / F |
| Review selection deletion | Delete or Backspace |
| Undo the last planner deletion | Ctrl/Command+Z |
| Show shortcuts | ? or **Keyboard shortcuts** |
| Cancel a connection / close a dialog | Escape |

Canvas shortcuts apply while working on the canvas, not while typing in a form.
**Reset layout** clears the current canvas's saved positions after confirmation.
It leaves cards, flow and other canvases intact.

## Delete and recover planning

**Delete selection** reviews one combined deletion. Deleting a container also
deletes its descendants, their flow and attached annotations, incoming planning
references and saved positions. Shared notes keep their remaining anchors.

Review the scope before confirming. **Undo last deletion** can restore the most
recent planner deletion while that planner session remains mounted. It includes
the affected notes and layouts and refuses to overwrite later changes to those
records. It is not an undo history, and it does not undo imports or reset layouts.

For larger recovery needs, use the host's
[backup and recovery workflow](../../ttrpg-codex/docs/SELF_HOSTING.md#backups).
[Replacement imports](IMPORTING.md#merge-and-replacement) can delete the entire
DM Tools planning dataset and all layouts; they are not a targeted delete tool.

## Keep drafts and handle concurrent edits

Existing-item, annotation and new-flow drafts survive selection changes,
canvas navigation, other saves, validation errors and explicit reload while
the planner stays open. Each draft keeps the revision it began with.
**Discard edits** loads the latest fetched values for that record. Text from
a removed record remains available to copy before discarding.

| Situation | What to do |
| --- | --- |
| New data is available while reading or editing | Finish the current task, then use **Reload planner** when ready |
| A save conflicts with another change | Reload, compare the saved values with the retained draft, then deliberately revise or discard it |
| A draft's parent or target has disappeared | Select a valid replacement or discard the affected edit |
| A read or write fails | Use **Reload planner** before another mutation; copy retained text if needed |
| A save succeeded but its confirming read failed | Reload to inspect it; the planner does not submit the confirmed write again |
| Creation response was lost | Reload; the planner reconciles the same item ID instead of creating a duplicate |

A change anywhere in the six planning collections can cause a conflict, even
an unrelated layout change on another canvas. This deliberately favors explicit
review over silently overwriting another editor's work. Reload never silently
replaces a draft's opening revision.

Leaving the planner, signing out or reloading the browser warns about unsaved
edits. Canceling preserves them; accepting the departure discards them. Pending
saves block ordinary navigation until their outcome is known. **Drafts are not
persisted across an accepted browser reload or forced add-on/authority teardown.**

## Share a link with another DM view

Planner links use `#/addons/dm-tools/planner?item=<id>`. Containers open their
own canvas. Events and branches select the item on its parent canvas and open
the reader. Reload, a new tab and browser Back retain that target; the link
does not grant access to private DM data.

An invalid query keeps an already open planner and its drafts, or shows recovery
on first entry. A deleted target returns to the campaign canvas with an
explanation. For implementation details, see the [graph contract](GRAPH.md).
