# Generating importable planning content

Use this guide when turning notes, a conversation or an agent's proposal into
DM Tools planning JSON. It applies to people and automation. The output is a
reviewable story plan; generating it does not import or approve it.

This guide is the authoring contract. The [planner model](GRAPH.md) explains the
structural rules in depth and the [Import Center guide](IMPORTING.md) covers
review, updates and recovery. The linked schemas and the
[Go validator](../internal/planning/model.go) are the authority; old exports and
remembered commands are not.

## The workflow

1. **Export.** The DM opens **Import Center** and chooses **Download planning
   data**. The file is the current planning dataset as a merge document: every
   record with its exact ID and `expectedUpdatedAt`. It contains private DM
   planning, so share it only with tools the DM trusts.
2. **Brief.** The DM gives the author the export and a brief
   (see [below](#prepare-the-context)).
3. **Write.** The author writes a new merge document containing only the
   records to create or change.
4. **Check.** From a clone of this repository, run the importer's own
   validation offline against the export:

   ~~~text
   go run ./cmd/check-plan plan.json dm-tools-planning-2026-10-11.json
   ~~~

   Fix every reported problem and run it again until it prints `VALID`.
5. **Import.** The DM chooses the file in the Import Center, reads the preview
   and commits it.
6. **Repeat.** Download a fresh export before the next batch. An export taken
   before a commit is stale afterwards.

New NPCs, locations and relationships are core campaign records, which this
format can only reference. To create them together with planning, wrap the
planning document in a [campaign bundle](#campaign-bundles).

## Prepare the context

Give the writer enough context to distinguish campaign facts from proposed
material. A useful brief is:

~~~text
Task: What should this plan add or change?
Story: Premise, current situation, characters' goals and unresolved threads.
Scope: Destination plotline/quest ID, or an explicitly new root-level story.
Constraints: Tone, language, session length, boundaries and required outcomes.
Known facts: Established events and relationships that must remain consistent.
Allowed invention: What new scenes, characters or possibilities may be proposed.
Existing targets: Core records (collection, ID, name) the plan may reference.
Planning export: The current export file, or "empty campaign".
Preserve: Content or fields that must remain unchanged.
Output: A merge JSON file plus a separate summary of changes and open questions.
~~~

Do not put credentials, tokens, worker paths or unrelated campaign dumps into
the brief.

### Where identities come from

| Identity | Source |
| --- | --- |
| Planning item, flow, reference, consequence or note | The planning export |
| A planning item's ID, without an export | The planner link `#/addons/dm-tools/planner?item=<id>` |
| A core character, faction, location, mystery, artifact or event | The record page's address, `#/<collection>/<id>` |
| An external add-on record | That add-on's own documentation or export |

If a required identity or update baseline is missing, say what is needed and
continue with work that does not depend on it. Never invent an existing ID,
timestamp or claimed validation. New fiction may be proposed within the brief's
scope, but it must not silently become an established campaign fact.

## Turn the story into records

First outline ownership and playable choices; then serialize them.

| Record | Use it for |
| --- | --- |
| Plotline | A larger story arc containing quests or other planning items |
| Quest | A concrete objective that may contain encounters, scenes or branches |
| Event | One story scene, encounter or puzzle; it cannot own child items |
| Branch | A decision, condition or random fork between sibling items |
| Flow | A possible progression between different immediate siblings |
| Reference | A named association with a planning, campaign or external record |
| Consequence | A possible world change, reward, information or complication |
| DM note | Marginalia or shared preparation attached to several items, or left unanchored |

Separate ownership from flow. A quest does not flow to its own child encounter.
Place the encounters and branch under that quest, then connect those siblings.
Use a reference for a cross-scope association. Avoid forcing a single outcome:
describe the trigger on each flow and keep meaningful alternatives. A
consequence describes what the DM may apply; it does not execute it.

Write useful content in the supported item fields:

| Field | Writing purpose |
| --- | --- |
| `title` | A short, distinct name recognizable on the canvas |
| `summary` | The situation and why the scene matters at a glance |
| `body` | Detailed prose, clues, dialogue or encounter/puzzle preparation |
| `objective` | What the characters can accomplish |
| `setup` | Starting circumstances and information the DM needs |
| `resolution` | Possible outcomes, including failure or an unexpected approach |
| `tags` | A small consistent vocabulary for finding related material |

Use Markdown inside text fields. Do not add invented fields such as
`readAloud`, `clues`, `difficulty`, `probability` or `rewards`; every unknown
field is rejected. Put those details under clear headings in the appropriate
prose field, or use a consequence where it represents a planned outcome. Keep
technical status and authoring assumptions in the separate handoff summary
unless they are useful DM notes intentionally included in the plan.

## Build the import envelope

~~~json
{
  "format": "dm-tools-planning",
  "schemaVersion": 3,
  "generatedAt": 1785024000000,
  "mode": "merge",
  "items": [],
  "flowLinks": [],
  "references": [],
  "consequences": [],
  "notes": []
}
~~~

All five arrays are required; emit `[]` when empty. `mode` defaults to `merge`,
but write it explicitly. The root permits only the fields shown above. There is
no `views`, `context`, `characters`, `locations`, `addons` or per-record
`delete` entry.

`generatedAt` is the current time in epoch milliseconds, for example from
`node -p "Date.now()"`; not seconds or an ISO date. The importer stores it as
`updatedAt` on every changed record, so a changed update needs a `generatedAt`
later than that record's stored time. Never invent a future time to get past
this check.

Each record carries `schemaVersion: 3`, all of its stored fields except
`updatedAt`, and import-only metadata:

| Operation | Metadata and behavior |
| --- | --- |
| `create` | Add `"operation": "create"`; omit `expectedUpdatedAt` |
| `update` | Add `"operation": "update"` and the exact stored `expectedUpdatedAt`; send the complete record |

Neither `operation` nor `expectedUpdatedAt` is stored. A create whose ID
already exists with identical content is reported as unchanged; with different
content it is rejected. See [timestamp rules](IMPORTING.md#updates-and-timestamps).

**A merge update replaces the whole record.** Copy the record from the export,
change only what was requested and keep `expectedUpdatedAt`. Emptying a field
is an edit, not a way to leave it unchanged. Leave records you are not changing
out of the plan; merge keeps them. An unedited export imports as a no-op, so
leftover unchanged records do no harm, but they hide the real change in review.

## Fields, identities and limits

These are the authored fields in addition to `id`, `schemaVersion` and import
metadata. All are required unless marked optional.

| Array | Fields | Owning schema |
| --- | --- | --- |
| `items` | `kind, parentId, title, summary, body, objective, setup, resolution, tags`; `eventType` or `branchType` by kind | [Item](../contracts/planning-item.schema.json) |
| `flowLinks` | `sourceId, targetId, kind, label` | [Flow](../contracts/planning-flow.schema.json) |
| `references` | `itemId, name, relation, target, quantity, notes` | [Reference](../contracts/planning-reference.schema.json) |
| `consequences` | `anchor, kind, title, body`; optional `target` | [Consequence](../contracts/planning-consequence.schema.json) |
| `notes` | `title, body, anchorIds` | [DM note](../contracts/dm-note.schema.json) |

IDs match `^[a-z0-9][a-z0-9._-]{0,119}$`; `__proto__`, `prototype` and
`constructor` are forbidden. IDs are unique within each array; using a distinct
prefix for each batch (for example `ferry-`) keeps them unique across arrays and
easy to recognize. An ID never changes when a title does.

- `kind` is `plotline`, `quest`, `event` or `branch`. `parentId` is the ID of a
  plotline or quest, stored or in the same file, or JSON `null` for the
  campaign root. Events and branches cannot have children.
- An event requires `eventType`: `story`, `encounter` or `puzzle`. A branch
  requires `branchType`: `decision`, `condition` or `random`. Other kinds omit
  both fields.
- Flow `kind` is `continues` or `option`; an option must start at a branch.
  Both endpoints must have the same `parentId`, differ from each other, and the
  flows on a canvas must not form a cycle.
- Reference `relation` is `related`, `involves`, `features`, `located-at`,
  `opposes`, `supports`, `reveals`, `requires` or `rewards`. `quantity` is an
  integer from 1 to 1,000; use `1` unless counting something. `name` is the
  readable label shown when the target is unavailable.
- Consequence `kind` is `world`, `reward`, `information` or `complication`.
- `anchorIds` lists up to 100 distinct planning-item IDs; an empty array is an
  unanchored note.
- Tags are unique ignoring case and must not be blank.
- Item, consequence and note titles and reference names must contain visible
  text. Other text fields may be `""`.

Text limits count characters, as in the schemas:

| Field | Maximum |
| --- | --- |
| Item `title` | 160 |
| Item `summary` | 2,000 |
| Item `objective` | 10,000 |
| Item `setup`, `resolution` | 30,000 each |
| Item `body` | 80,000 |
| Item `tags` | 40 tags of 1–60 characters |
| Flow `label`; reference `name`; consequence and note `title` | 200 |
| Reference `notes` | 2,000 |
| Consequence `body` | 10,000 |
| Note `body` | 30,000 |

### Targets and anchors

These are field fragments, not complete import documents:

~~~json
{"scope": "planning", "itemId": "existing-planning-id"}
{"scope": "core", "collection": "locations", "id": "existing-location-id"}
{"scope": "external", "addonId": "example-addon", "kind": "record-kind", "id": "existing-record-id", "label": "Readable name"}
~~~

A core target uses one of `characters`, `factions`, `locations`, `mysteries`,
`artifacts` or `events`. Its ID must also match the ID pattern above, so a core
record with another kind of key, such as one containing capitals or spaces,
cannot be a target; name it in prose instead. An
external target names a real provider and record (`kind` 1–80 characters,
`label` 1–200); never infer it from a display name or manufacture a URL.

A consequence's `anchor` is `{"scope": "item", "itemId": "…"}` or
`{"scope": "flow", "flowId": "…"}`. Omit an unused optional `target` rather than
sending `null`.

Planning targets, anchors, parents and flow endpoints must exist in the
resulting dataset: stored, or created in the same file. Preview and
`check-plan` verify this. Neither checks that core or external targets exist;
`check-plan` lists them so they can be confirmed against the campaign.

## Reviewable batches and replacement

Keep each file small enough to review, with at most 256 actual writes and
deletions. Flows, references, consequences, notes and replacement deletions all
count; unchanged records do not. The Import Center accepts files up to 2 MiB.

Split large work into coherent **merge** batches. Create parents before
children and endpoints before flows, or include them in the same batch. Every
intermediate dataset must be valid. Export again after each committed batch;
several files prepared against the same export cannot all be committed.

Use `replace` only when complete-dataset replacement was explicitly requested.
All incoming entries then use `create`. Omitted records and **all saved
layouts** are deleted, including unrelated stories outside the open canvas.
Never use replacement as a workaround for a conflict or to replace one quest.
Explain the exact deletion scope before such an import.

## Check a file

`go run ./cmd/check-plan plan.json [export.json]` runs the Import Center's
preview code against the export, or against an empty campaign without one.
It needs Go and a clone of this repository, and works without a running site.

- `VALID` lists the creates, updates and unchanged records, the core and
  external targets to confirm, and warnings such as a future `generatedAt`.
- `INVALID` prints the importer's reason and the affected record, and exits 1.

It cannot detect edits made on the site after the export, or replacement's
layout deletions. The Import Center preview remains the final check before
commit, and passing either check does not approve the story.

The [worked examples](#worked-examples) also run through the real importer in
the test suite:

~~~text
go test ./internal/importer -run 'TestDocumentedPlanningExamples|TestCheck'
~~~

## Campaign bundles

The host's `ttrpg-codex-campaign-bundle` format creates characters, locations
and relationships, and can carry one planning document in the same reviewed,
atomic import. Planning targets can then point at those new records through
`{"$ref": "local-name"}` placeholders in place of the core ID. Follow the host's
[campaign bundle guide](https://github.com/pjunak/ttrpg-codex/blob/main/docs/reference/CAMPAIGN_BUNDLES.md).

`check-plan` accepts a bundle file and checks its planning document, treating
each placeholder as its local name. The host validates the core records during
the Import Center preview.

## Worked examples

| Example | Expected result |
| --- | --- |
| [Minimal sibling flow](examples/planning-siblings.json) | Four creates in an empty campaign |
| [Annotated story context](examples/planning-context.json) | Fifteen creates: nested scenes, a branch, local flows, a cross-scope reference, consequences and shared notes |
| [Planning export](examples/planning-export.json) | The export of the minimal example after it was imported |
| [Complete-record update](examples/planning-update.json) | One update against that export |
| [Invalid cross-parent flow](examples/planning-cross-parent-flow.json) | A flow fragment to substitute into the minimal example; it is rejected because a child cannot flow to its parent |

Example IDs and times are synthetic. The context example is an alternative to
the minimal example, not an increment on top of it.

## Handoff

Deliver the JSON file, UTF-8 without Markdown fences or commentary, separately
from a short handoff: intended scope and mode, expected changes, core and
external targets to confirm, proposed material and open questions, the checks
actually run and their results, and any destructive effects. If a commit
result is uncertain, inspect current data before another attempt.

## Reusable agent instruction

~~~text
Prepare a dm-tools-planning schema-3 merge document from the supplied brief.
Read docs/AGENT_GENERATION.md in the addon-dm-tools repository and the schemas
it links. Take existing IDs, parents and expectedUpdatedAt values from the
supplied planning export; never invent identities, timestamps or validation.
Send complete records for updates and leave unchanged records out.
Propose new fiction only within the brief, and keep it separate from established
campaign facts. Model ownership first; flow joins distinct siblings and is
acyclic. Use references for cross-scope associations. Include all five root
arrays. Do not add fields, layouts or replacement mode.
Run `go run ./cmd/check-plan plan.json export.json` and fix every problem until
it prints VALID. Return the UTF-8 JSON file plus a separate change summary,
targets to confirm and the check output. Generating or checking a file does not
authorize importing it; apply only within the user's explicit authorization.
~~~
