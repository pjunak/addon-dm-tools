# Generating importable planning content

Use this guide when turning notes, a conversation or an agent's proposal into
DM Tools planning JSON. It applies to people and automation. The output is a
reviewable story plan; generating it does not import or approve it.

Read [the planner model](GRAPH.md) for structural rules and
[the Import Center guide](IMPORTING.md) for review, updates and recovery.
Use the current schemas linked below. Old exports and remembered tool commands
are not a substitute for the current format.

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
Existing targets: Exact collection/add-on, record IDs and display names.
Existing planning: Relevant parents, siblings, flow and annotations.
Updates: Complete current records with their exact updatedAt values.
Preserve: Content or fields that must remain unchanged.
Output: A merge JSON file plus a separate summary of changes and open questions.
~~~

Use authorized current data for existing IDs, ancestry and timestamps. Fetch
enough surrounding planning to check the complete affected graph, not just the
selected card. Do not put credentials, tokens, worker paths or a full unrelated
campaign dump into the brief.

If a required identity or update baseline is missing, identify what is needed
and continue work that does not depend on it. Do not fabricate an existing ID,
timestamp or claimed validation. New fictional material can be proposed within
the brief's scope, but it must not silently become an established campaign fact.

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

Separate ownership from flow. A quest does not flow to its child encounter.
Place the encounters and branch under that quest, then connect those siblings.
Use a reference for a cross-scope association. Avoid forcing a single outcome:
describe the trigger on each flow and retain meaningful alternatives. A
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
`readAloud`, `clues`, `difficulty`, `probability` or `rewards`.
Put those details under clear headings in the appropriate prose field, or use
a consequence where it represents a planned outcome. Keep technical status and
authoring assumptions in the separate handoff summary unless they are useful
DM notes intentionally included in the plan.

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

All five arrays are required; emit `[]` when empty. Use `merge` explicitly.
The root permits only the fields shown above. There is no `views`, `context`,
`characters`, `locations`, `addons` or per-record `delete` entry.

Replace the example time with an actual epoch-millisecond integer, for example
from `node -p "Date.now()"`. A changed update needs a time later than every
affected stored record. A future-looking baseline needs investigation; do not
invent a later time just to evade the check.

Each record carries `schemaVersion: 3`, its full stored fields except
`updatedAt`, and the following import-only metadata:

| Operation | Metadata and behavior |
| --- | --- |
| `create` | Add `operation: "create"`; omit `expectedUpdatedAt` |
| `update` | Add `operation: "update"` and the exact stored `expectedUpdatedAt`; retain the complete record |

The importer supplies `updatedAt` from root `generatedAt`; omit it from generated
entries. Neither `operation` nor `expectedUpdatedAt` is stored. Equivalent
creates can be skipped, but updates must first pass the expected-timestamp
check. See [timestamp rules](IMPORTING.md#updates-and-timestamps).

**A merge update replaces the whole record.** Begin with the current record and
preserve unrequested prose, tags and other fields. Keep separate annotations
unless their changes were requested. Emptying a field is an edit, not a way to
leave it unchanged.

## Required fields and identities

These are the authored fields in addition to `id`, `schemaVersion` and import
metadata:

| Array | Fields | Owning schema |
| --- | --- | --- |
| `items` | `kind, parentId, title, summary, body, objective, setup, resolution, tags` | [Item](../contracts/planning-item.schema.json) |
| `flowLinks` | `sourceId, targetId, kind, label` | [Flow](../contracts/planning-flow.schema.json) |
| `references` | `itemId, name, relation, target, quantity, notes` | [Reference](../contracts/planning-reference.schema.json) |
| `consequences` | `anchor, kind, title, body`; optional `target` | [Consequence](../contracts/planning-consequence.schema.json) |
| `notes` | `title, body, anchorIds` | [DM note](../contracts/dm-note.schema.json) |

IDs match `^[a-z0-9][a-z0-9._-]{0,119}$`; `__proto__`, `prototype` and
`constructor` are forbidden. Use unique, stable IDs within each collection and
retain them when titles change. A deliberate prefix helps keep newly proposed
records separate from existing content; it does not prove an ID is unused.

- `parentId` is an existing/included container ID or JSON `null` at campaign root.
- An event requires `eventType: "story" | "encounter" | "puzzle"` and no
  `branchType`. A branch requires `branchType: "decision" | "condition" | "random"`
  and no `eventType`. Other item kinds omit both.
- Flow kind is `continues` or `option`; an option must start at a branch.
- Reference relations are `related`, `involves`, `features`, `located-at`,
  `opposes`, `supports`, `reveals`, `requires` or `rewards`.
  Quantity is an integer from 1 to 1,000; `name` is the readable fallback.
- Consequence kind is `world`, `reward`, `information` or `complication`.
- `anchorIds` contains up to 100 distinct planning-item IDs; an empty array is
  an unanchored note. Tags are unique ignoring case.
- Required text may be `""` where its schema permits, but titles and reference
  names must not be blank. Stay within the schemas' limits; the worker also
  applies byte-length limits to text.

### Targets and anchors

These are field fragments, not complete import documents:

~~~json
{"scope": "planning", "itemId": "existing-planning-id"}
{"scope": "core", "collection": "locations", "id": "existing-location-id"}
{"scope": "external", "addonId": "example-addon", "kind": "record-kind", "id": "existing-record-id", "label": "Readable name"}
~~~

A core target uses one of `characters`, `factions`, `locations`, `mysteries`,
`artifacts` or `events`. An external target names a real provider and record;
never infer it from a display name or manufacture a URL.

A consequence's `anchor` is `{"scope":"item","itemId":"…"}` or
`{"scope":"flow","flowId":"…"}`. Omit an unused optional `target` rather than
sending `null`. Verify every reference, consequence target and note anchor
against the intended campaign. Preview checks planning-reference targets and
anchors, but does not establish core/external target existence. A consequence's
optional planning target also receives shape validation rather than an existence
check. Preview does not establish the correctness of narrative relationships.

## Reviewable batches and replacement

Keep each candidate small enough to review, with at most 256 actual writes and
deletions. This is not simply an item count: flows, references, consequences,
notes and replacement layout deletion all consume the same budget. Unchanged
records do not consume writes. Byte and record limits apply independently.

Split large work into coherent **merge** batches. Create needed parents before
children, and endpoints before flows, or include them in the same batch. Every
intermediate complete dataset must be valid. Refresh current data and timestamps
after a committed batch; several previews made against the same opening dataset
cannot be assumed valid after the first commit.

Use `replace` only when complete-dataset replacement was explicitly requested.
All incoming entries then use `create`. Omitted semantic records and **all saved
layouts** are deleted, including unrelated stories outside the open canvas.
Never use replacement as a workaround for a conflict or as a way to replace one
quest. Explain the exact deletion scope before an affected operation.

## Worked examples and validation

| Example | Expected result |
| --- | --- |
| [Minimal sibling flow](examples/planning-siblings.json) | Four creates in an empty dataset |
| [Annotated story context](examples/planning-context.json) | Fifteen creates: nested scenes, a branch, local flows, a cross-scope reference, consequences and shared notes |
| [Complete-record update](examples/planning-update.json) | One update after the minimal example is stored at its supplied timestamp |
| [Invalid cross-parent flow](examples/planning-cross-parent-flow.json) | A fragment to substitute into the minimal example; preview rejects its cross-canvas link |

Example IDs and times are synthetic. The context example is an alternative to
the minimal example, not an incremental file to apply on top of it. All its
planning targets are included; a production file must use its own observed IDs.

From the repository root, this command checks the examples through the actual
worker preview against synthetic current data:

~~~text
go test ./internal/importer -run TestDocumentedPlanningExamples
~~~

It validates repository examples, not an arbitrary user file. For a generated
file, first check JSON syntax, for example:

~~~text
node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" path/to/plan.json
~~~

A syntax check is not schema or campaign validation. Review structure and current
identities, then use the Import Center preview against the authorized target
campaign. Preview never approves the narrative or authorizes a commit.

Deliver the JSON file separately from a short handoff: intended scope and mode,
expected changes, known target dependencies, proposed material or open questions,
validation actually performed, and any destructive effects. If a commit result
is uncertain, inspect current data before another attempt.

## Reusable agent instruction

~~~text
Prepare a dm-tools-planning schema-3 merge document from the supplied brief.
Read the current agent-generation, import and graph guides and their schemas.
Use verified IDs, parents and exact updatedAt baselines for existing records.
Preserve all unrequested fields in complete-record updates. Propose new fiction
only within the brief, and separate it from established campaign facts.
Model ownership first; flow connects distinct immediate siblings and is acyclic.
Use references for cross-scope associations. Include all five root arrays.
Do not invent schema fields, identities, timestamps, authority or validation.
Do not include layouts or switch to replace to get around an error.
Keep batches reviewable and valid against the complete surrounding dataset.
Return a UTF-8 JSON file plus a separate change summary and validation results.
Generating a file or obtaining a preview does not authorize applying it.
Apply only within the user's existing explicit authorization; do not ask again
when that action and its scope have already been authorized.
~~~
