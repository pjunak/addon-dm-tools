# Agent guide: generating DM Tools plans

This is the authoritative guide for a person or LLM producing a reviewed
`dm-tools-planning` document. The format is strict. Do not invent fields,
workflow state, session tracking, or implied links.

## Purpose

Generate a forward-looking D&D story plan that a DM can inspect and modify:

- nested plotlines and quests;
- story events, encounters, and puzzles;
- explicit decisions, conditions, and random gates;
- stateless story flow;
- named links to NPCs, locations, factions, mysteries, artifacts, core events,
  monsters, rules, and optional-addon records;
- planned consequences;
- separate DM marginalia for facts learned at the table.

Do not generate:

- session scripts or assumed session boundaries;
- current, unlocked, active, chosen, completed, failed, or resolved state;
- automatic campaign mutations;
- inferred links merely because two records mention the same subject;
- canvas positions or any `planning_views` data;
- duplicate copies of core or addon records.

## Generation workflow

1. Gather the campaign premise, intended tone, known people/places/factions,
   optional source addons, and the DM’s desired level of detail.
2. Identify ownership before flow:
   - use plotlines for broad campaign-scale structures;
   - use quests for concrete goals and arbitrarily nested subquests;
   - use events and branches only as leaves.
3. Assign stable lowercase IDs before writing references.
4. Draft items in parent-before-child order.
5. Add only explicit flow links. Prefer links between siblings on the same
   canvas; cross-scope flow is supported when genuinely needed.
6. Add named references with fallback labels for optional-addon records.
7. Add intended consequences as annotations, not state changes.
8. Put retrospective facts in `notes`, not in the planning item body.
9. Validate every endpoint and anchor locally.
10. Split the result into ordered batches when more than 256 records would
    change. Import parent items before records that anchor to them.

## Root document

Every array is required even when empty.

```json
{
  "format": "dm-tools-planning",
  "schemaVersion": 2,
  "generatedAt": 1785024000000,
  "items": [],
  "flowLinks": [],
  "references": [],
  "consequences": [],
  "notes": []
}
```

`generatedAt` is a non-negative epoch-millisecond integer. It becomes the
stored `updatedAt` of every changed record.

Every record includes:

```json
{
  "operation": "create"
}
```

or:

```json
{
  "operation": "update",
  "expectedUpdatedAt": 1785000000000
}
```

Creates must omit `expectedUpdatedAt`. Updates must copy it exactly from the
current exported record. Never guess a revision.

## IDs

All DM Tools ids:

- contain 1–120 characters;
- start with a lowercase ASCII letter or digit;
- then use lowercase letters, digits, `.`, `_`, or `-`;
- must not be `__proto__`, `prototype`, or `constructor`;
- remain stable across updates.

Use semantic ids such as:

```text
plotline-waking-dragons
quest-investigate-earthquake
event-cultist-ambush
branch-free-the-prisoner
flow-ambush-to-prisoner
reference-ambush-cultists
consequence-town-friendly
note-duke-insulted
```

## Planning items

Common fields:

| Field | Contract |
|---|---|
| `id` | Stable DM Tools id. |
| `schemaVersion` | Exactly `2`. |
| `operation` | `create` or `update`. |
| `expectedUpdatedAt` | Required only for updates. |
| `kind` | `plotline`, `quest`, `event`, or `branch`. |
| `parentId` | Owning plotline/quest id, or `null` for campaign root. |
| `title` | Required, 1–160 characters. |
| `summary` | Concise canvas text, at most 2,000 characters. |
| `body` | Full planning prose, at most 80,000 characters. |
| `objective` | Intended goal or dramatic purpose, at most 10,000 characters. |
| `setup` | Type-specific preparation, at most 30,000 characters. |
| `resolution` | Intended result/solution, at most 30,000 characters. |
| `tags` | Up to 40 unique strings, each at most 60 characters. |

Plotlines and quests omit `eventType` and `branchType`.

```json
{
  "id": "plotline-waking-dragons",
  "schemaVersion": 2,
  "operation": "create",
  "kind": "plotline",
  "parentId": null,
  "title": "The Waking Dragons",
  "summary": "Ancient dragons wake as forgotten seals fail.",
  "body": "The awakenings are symptoms of a coordinated attempt to unmake the old compact.",
  "objective": "Let the party discover the common cause behind apparently separate disasters.",
  "setup": "",
  "resolution": "",
  "tags": ["dragons", "main plot"]
}
```

### Ownership

The campaign root may own any item. A plotline or quest may own:

- nested plotlines;
- quests and nested quests;
- events;
- branches.

Events and branches may not own children. Ownership must be acyclic.

Use ownership for containment, never to say “happens next.” Use a flow link for
sequence. A quest can be both a self-contained plan and a child of a larger
plotline.

### Event types

An event requires one `eventType`:

- `story` — a planned beat that needs no specialized screen;
- `encounter` — a scene with participants, opposition, terrain, and potential
  future combat handling;
- `puzzle` — a challenge with presentation, clues, solution, and failure paths.

```json
{
  "id": "event-cultist-ambush",
  "schemaVersion": 2,
  "operation": "create",
  "kind": "event",
  "parentId": "quest-investigate-earthquake",
  "eventType": "encounter",
  "title": "Cultist Ambush at the Broken Bridge",
  "summary": "Cultists try to recover the seal fragment before the party crosses.",
  "body": "The attackers value the fragment more than victory and retreat if it is secured.",
  "objective": "Reveal that an organized group expected the earthquake.",
  "setup": "Narrow bridge, unstable masonry, river thirty feet below.",
  "resolution": "A captured cultist carries a route to the ruined observatory.",
  "tags": ["cult", "bridge"]
}
```

For an encounter, put statblocks and present NPCs in `references`; use
`quantity` for repeated monsters. Do not embed copied statblocks in prose.

For a puzzle, use:

- `objective` for its purpose in the story;
- `setup` for presentation, clues, and usable hints;
- `resolution` for solution, alternate solutions, and consequences of failure.

### Branch types

A branch requires one `branchType`:

- `decision` — the party or an NPC chooses;
- `condition` — a world or meta condition determines the route;
- `random` — a roll or random table result determines the route.

```json
{
  "id": "branch-free-the-prisoner",
  "schemaVersion": 2,
  "operation": "create",
  "kind": "branch",
  "parentId": "quest-investigate-earthquake",
  "branchType": "decision",
  "title": "What happens to the captured cultist?",
  "summary": "The party may release, question, or hand over the prisoner.",
  "body": "",
  "objective": "Make the cost of choosing allies explicit.",
  "setup": "",
  "resolution": "",
  "tags": []
}
```

A condition gate can represent meta input such as “the group takes a long rest
in the cursed forest” or “the d100 result is 01–05.” A normal in-world
occurrence such as an earthquake remains an event, not a special trigger type.

Branches store possible routes only. Never record which option was selected.

## Flow links

Flow is directed and acyclic.

| Field | Contract |
|---|---|
| `id` | Stable id. |
| `schemaVersion` | Exactly `2`. |
| `sourceId` | Existing planning item id. |
| `targetId` | Different existing planning item id. |
| `kind` | `continues` or `option`. |
| `label` | Optional visible line label, at most 200 characters. |

`option` must originate at a `branch` item. Use its label for the choice,
condition, or random result.

```json
{
  "id": "flow-prisoner-to-observatory",
  "schemaVersion": 2,
  "operation": "create",
  "sourceId": "branch-free-the-prisoner",
  "targetId": "quest-ruined-observatory",
  "kind": "option",
  "label": "Question the prisoner"
}
```

Prefer sibling-to-sibling links because they are directly editable on one
canvas. Cross-scope links are legal and roll up to the visible owning card.
Do not add an edge just because ownership already implies containment.

## Named references

A reference belongs to one planning item and names its semantic relationship to
a target.

| Field | Contract |
|---|---|
| `itemId` | Existing planning item id. |
| `name` | Descriptive relationship, 1–200 characters. |
| `relation` | One allowed relation below. |
| `target` | Planning, core, or optional-addon target. |
| `quantity` | Integer 1–1,000; default intent is 1. |
| `notes` | Optional details, at most 2,000 characters. |

Relations:

```text
related
involves
features
located-at
opposes
supports
reveals
requires
rewards
```

Core target:

```json
{
  "scope": "core",
  "collection": "characters",
  "id": "npc-mira"
}
```

Allowed core collections are `characters`, `factions`, `locations`,
`mysteries`, `artifacts`, and `events`.

Optional-addon target:

```json
{
  "scope": "external",
  "addonId": "example-bestiary",
  "kind": "monster",
  "id": "cult-fanatic",
  "label": "Cult Fanatic"
}
```

The fallback `label` is mandatory so the plan remains readable when that addon
is disabled or absent.

Planning target:

```json
{
  "scope": "planning",
  "itemId": "quest-ruined-observatory"
}
```

Use a planning target for a named thematic relationship, not chronology.

Complete encounter participant:

```json
{
  "id": "reference-ambush-cultists",
  "schemaVersion": 2,
  "operation": "create",
  "itemId": "event-cultist-ambush",
  "name": "Attacks from both ends of the bridge",
  "relation": "opposes",
  "target": {
    "scope": "external",
    "addonId": "example-bestiary",
    "kind": "monster",
    "id": "cult-fanatic",
    "label": "Cult Fanatic"
  },
  "quantity": 4,
  "notes": "One carries the seal fragment."
}
```

Do not invent core ids. Ask for them, use an export, or use campaign-bundle
`$ref` resolution.

## Planned consequences

A consequence is an annotation, never applied state.

| Field | Contract |
|---|---|
| `anchor` | `{"scope":"item","itemId":"..."}` or `{"scope":"flow","flowId":"..."}`. |
| `kind` | `world`, `reward`, `information`, or `complication`. |
| `title` | Required concise result, at most 200 characters. |
| `body` | Optional detail, at most 10,000 characters. |
| `target` | Optional planning/core/external target using the reference shape. |

```json
{
  "id": "consequence-town-friendly",
  "schemaVersion": 2,
  "operation": "create",
  "anchor": {
    "scope": "item",
    "itemId": "quest-investigate-earthquake"
  },
  "kind": "world",
  "title": "The town treats the party as trusted allies",
  "body": "Local officials share records and offer secure lodging."
}
```

If the result needs its own incoming/outgoing story flow, create an event
instead of overloading a consequence.

## DM marginalia

Marginalia is retrospective or table-derived information kept separate from
the plan. A note may link to multiple planning items or none.

```json
{
  "id": "note-duke-insulted",
  "schemaVersion": 2,
  "operation": "create",
  "title": "The party publicly insulted Duke Ren",
  "body": "The duke remained polite, but his steward ended the audience early.",
  "anchorIds": [
    "plotline-court",
    "quest-secure-dukes-support"
  ]
}
```

Good marginalia:

- the party angered an NPC;
- somebody was killed unexpectedly;
- an improvised promise became important;
- a fact the DM wants visible next to several planned items.

Do not move predictable setup, intended outcomes, or encounter tactics into
marginalia.

## Complete example

```json
{
  "format": "dm-tools-planning",
  "schemaVersion": 2,
  "generatedAt": 1785024000000,
  "items": [
    {
      "id": "plotline-waking-dragons",
      "schemaVersion": 2,
      "operation": "create",
      "kind": "plotline",
      "parentId": null,
      "title": "The Waking Dragons",
      "summary": "Ancient dragons wake as forgotten seals fail.",
      "body": "",
      "objective": "Reveal the common cause behind regional disasters.",
      "setup": "",
      "resolution": "",
      "tags": ["dragons"]
    },
    {
      "id": "event-earthquake",
      "schemaVersion": 2,
      "operation": "create",
      "kind": "event",
      "parentId": "plotline-waking-dragons",
      "eventType": "story",
      "title": "The Earth Shakes",
      "summary": "A seal breaks as the dragon stirs.",
      "body": "",
      "objective": "Make the awakening impossible to ignore.",
      "setup": "",
      "resolution": "",
      "tags": []
    },
    {
      "id": "quest-investigate-earthquake",
      "schemaVersion": 2,
      "operation": "create",
      "kind": "quest",
      "parentId": "plotline-waking-dragons",
      "title": "Investigate the Earthquake",
      "summary": "Trace the tremor to the ruined observatory.",
      "body": "",
      "objective": "Connect the disaster to deliberate sabotage.",
      "setup": "",
      "resolution": "",
      "tags": []
    }
  ],
  "flowLinks": [
    {
      "id": "flow-earthquake-investigation",
      "schemaVersion": 2,
      "operation": "create",
      "sourceId": "event-earthquake",
      "targetId": "quest-investigate-earthquake",
      "kind": "continues",
      "label": "The town asks for help"
    }
  ],
  "references": [],
  "consequences": [
    {
      "id": "consequence-town-trust",
      "schemaVersion": 2,
      "operation": "create",
      "anchor": {
        "scope": "item",
        "itemId": "quest-investigate-earthquake"
      },
      "kind": "world",
      "title": "The town trusts the party",
      "body": ""
    }
  ],
  "notes": []
}
```

## Campaign-bundle references

Inside the host campaign-bundle importer only, a core target id may be an exact
reference object:

```json
{
  "scope": "core",
  "collection": "characters",
  "id": { "$ref": "npc.duke-ren" }
}
```

The host resolves it to a reserved persistent ID before DM Tools validates the
document. Do not use `$ref` in standalone planning files, in external targets,
or as part of a larger string.

## Updates and batching

For updates:

1. start from a current export;
2. preserve record ids;
3. set `operation` to `update`;
4. copy the exact current `updatedAt` to `expectedUpdatedAt`;
5. omit `updatedAt`;
6. set root `generatedAt` later than every changed record;
7. include unchanged arrays as empty unless those records are needed for the
   imported candidate’s new references.

One preview may change at most 256 records. Split larger plans so each batch is
independently valid:

1. parent items;
2. child items;
3. flow and references;
4. consequences and marginalia.

Never split a required anchor from the record that first creates it unless an
earlier committed batch already created that anchor.

## Final checklist

- Root format and schema are exact.
- All five arrays exist.
- IDs are stable, valid, and unique within each collection.
- Every child parent exists and is a plotline or quest.
- Ownership has no cycle.
- Every event has `eventType`; other kinds omit it.
- Every branch has `branchType`; other kinds omit it.
- Flow endpoints exist, differ, and form a DAG.
- Every option starts at a branch.
- Every reference item and target exists or has a valid optional-addon fallback.
- Every consequence anchor exists.
- Every marginalia anchor exists.
- Encounter quantities are explicit.
- Updates have exact revisions; creates omit revisions.
- There are no canvas positions, progress states, sessions, or invented fields.
- The preview contains no errors before the DM approves commit.
