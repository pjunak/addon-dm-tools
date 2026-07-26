# Generating Campaign Plans with an AI Agent

Use this guide when an AI assistant generates a complete or partial campaign
planning structure for DM Tools. The output is a reviewed import document, not
an instruction to edit campaign files directly.

The same records power the manual Planning Workspace, the Import Center, and
the Planning Graph. A structure imported from an agent remains fully editable
by the DM afterward.

## Safe workflow

1. Ask the DM what part of the campaign to model and which existing records may
   be referenced.
2. Obtain the current planning ids and `updatedAt` values before proposing
   updates. Obtain real core entity ids before linking characters, factions,
   locations, mysteries, artifacts, or events.
3. Draft folders, then planning items and their named sections, then links.
4. Validate every reference against the final draft.
5. Split changes into ordered documents of at most 256 changed records each.
6. Give the DM the JSON file. The DM uploads it to the Import Center, reviews
   the exact writes and diagnostics, and explicitly confirms the atomic commit.

Never write into `data/`, addon collection files, backups, or transaction
journals. Never guess an existing record id. If the necessary inventory is not
available, leave that link out and list it as unresolved for the DM.

## Document envelope

```json
{
  "format": "dm-tools-planning",
  "schemaVersion": 1,
  "generatedAt": 1785024000000,
  "folders": [],
  "items": [],
  "links": []
}
```

- `generatedAt` is the generation time as a non-negative Unix epoch integer in
  milliseconds. It becomes `updatedAt` for every changed record.
- All three collection arrays are required, even when empty.
- Unknown fields are rejected.
- One preview may contain no more than 256 writes and 2 MiB of operation data.
- A preview never changes data. The commit applies its exact stored operations
  atomically; provider code is not run again during commit.

## Create and update control fields

Every folder, item, and link has an import-only `operation`.

For a new record:

```json
{
  "id": "quest-stolen-sigil",
  "operation": "create"
}
```

For an existing record:

```json
{
  "id": "quest-stolen-sigil",
  "operation": "update",
  "expectedUpdatedAt": 1784937600000
}
```

`expectedUpdatedAt` must exactly match the current stored record. It is
required for `update` and forbidden for `create`. A mismatch blocks the entire
commit instead of overwriting newer work. An identical record is skipped even
when the requested operation would otherwise write it.
For a changed update, `generatedAt` must also be later than
`expectedUpdatedAt`, so record timestamps remain monotonic.

Imports do not delete records. Deletion remains an explicit manual action.

## Identifiers

Planning item and folder ids:

- 1–120 characters;
- start with a lowercase letter or digit;
- then use lowercase letters, digits, `.`, `_`, or `-`;
- remain stable after creation.

Section ids use the same characters and are limited to 80 characters. They
need to be unique only inside their planning item, but should still describe
their purpose, such as `audience-with-duke` or `vault-confrontation`.

Prefer descriptive ids over sequential ids. Do not rename an id during an
update; create-and-delete is not supported by the import format.

## Folders

Folders organize navigation. They do not imply story dependency, chronology,
or graph relationships.

```json
{
  "id": "arc-glass-crown",
  "schemaVersion": 1,
  "operation": "create",
  "name": "The Glass Crown",
  "parentId": null,
  "order": 0
}
```

| Field | Contract |
|---|---|
| `name` | Required, 1–160 characters. |
| `parentId` | Existing folder id or `null`. |
| `order` | Integer from 0 to 1,000,000. |

Folder parents must exist in the local data or the same import. Cycles are
rejected.

## Planning items

```json
{
  "id": "quest-stolen-sigil",
  "schemaVersion": 1,
  "operation": "create",
  "kind": "quest",
  "title": "Recover the Stolen Sigil",
  "summary": "The duke's seal was taken before the peace summit.",
  "body": "The thief intends to expose the duke, not sell the seal.",
  "folderId": "arc-glass-crown",
  "tags": ["court", "investigation"],
  "state": "ready",
  "pinned": true,
  "sections": [
    {
      "id": "audience-with-duke",
      "title": "Audience with the Duke",
      "body": "The duke conceals why the sigil can open the old vault."
    },
    {
      "id": "vault-confrontation",
      "title": "Vault Confrontation",
      "body": "The opposition changes if the party publicly accused the duke."
    }
  ]
}
```

### Item kinds

| Kind | Use it for |
|---|---|
| `thread` | A broad plot pressure or evolving world-level concern. |
| `quest` | A player-facing objective with meaningful stages or choices. |
| `scenario` | A situation the DM can introduce without assuming a fixed player response. |
| `encounter` | A prepared social, exploration, puzzle, hazard, or combat setup. |
| `note` | Reusable world-building material that benefits from links and graph placement. |

Do not create a session record merely because preparation happens between
sessions. Do not model routine retrospective notes, attendance, or automatic
quest progress.

### Item fields

| Field | Contract |
|---|---|
| `title` | Required, 1–160 characters. |
| `summary` | Plain text, at most 2,000 characters. |
| `body` | Main planning notes, at most 80,000 characters. |
| `folderId` | Existing folder id or `null`. |
| `tags` | Up to 40 unique strings, each at most 60 characters. |
| `state` | `idea`, `ready`, `active`, `resolved`, or `archived`. |
| `pinned` | Boolean; use sparingly for dashboard visibility. |
| `sections` | Up to 80 stable named sections. |

Each section has exactly `id`, `title`, and `body`. Its title is required and
limited to 160 characters; its body is limited to 30,000 characters.

Use sections when something needs its own incoming or outgoing link. Good
sections include quest stages, possible revelations, encounter beats, a
specific location within a scenario, or distinct factions in a conflict.
Avoid turning every paragraph into a section.

## Named links

A link combines a fixed semantic `type` with a specific human-readable `name`.
The type supports filtering and consistent graph behavior. The name explains
the actual campaign connection and is always shown on the graph edge.

```json
{
  "id": "link-mira-sigil-audience",
  "schemaVersion": 1,
  "operation": "create",
  "name": "Requests a discreet investigation",
  "type": "involves",
  "source": {
    "scope": "core",
    "collection": "characters",
    "id": "mira-vel"
  },
  "target": {
    "scope": "planning",
    "itemId": "quest-stolen-sigil",
    "sectionId": "audience-with-duke"
  },
  "notes": "Mira refuses to discuss the vault in front of the court."
}
```

When the quest is collapsed, this edge connects Mira to the quest node. When
the quest is expanded, it connects Mira to the exact `Audience with the Duke`
section node. The edge name remains visible in both views.

Allowed relation types:

| Type | Meaning |
|---|---|
| `related` | Neutral association when no stronger meaning applies. |
| `involves` | The source participates in or is directly part of the target. |
| `supports` | The source helps, reinforces, or makes the target more likely. |
| `opposes` | The source obstructs, conflicts with, or threatens the target. |
| `reveals` | The source exposes information represented by the target. |
| `requires` | The source depends on the target. Direction matters. |

Do not encode the custom edge name by inventing a new relation type.

### Planning endpoints

Whole item:

```json
{ "scope": "planning", "itemId": "quest-stolen-sigil" }
```

Specific section:

```json
{
  "scope": "planning",
  "itemId": "quest-stolen-sigil",
  "sectionId": "vault-confrontation"
}
```

The item and section must exist locally or in the same import.

### Core entity endpoints

```json
{
  "scope": "core",
  "collection": "characters",
  "id": "mira-vel"
}
```

`collection` is one of:

- `characters`
- `factions`
- `locations`
- `mysteries`
- `artifacts`
- `events`

The id must refer to a real campaign record. An unresolved core reference
blocks the import.

### External addon endpoints

```json
{
  "scope": "external",
  "addonId": "future-homebrew",
  "kind": "rule",
  "id": "stress-check",
  "label": "Stress Check"
}
```

External endpoints are intentionally loose so independent addons can remain
optional. DM Tools stores the identity and fallback label but does not require
or query the other addon. The graph remains useful when that addon is absent.

## Complete minimal example

```json
{
  "format": "dm-tools-planning",
  "schemaVersion": 1,
  "generatedAt": 1785024000000,
  "folders": [
    {
      "id": "arc-glass-crown",
      "schemaVersion": 1,
      "operation": "create",
      "name": "The Glass Crown",
      "parentId": null,
      "order": 0
    }
  ],
  "items": [
    {
      "id": "quest-stolen-sigil",
      "schemaVersion": 1,
      "operation": "create",
      "kind": "quest",
      "title": "Recover the Stolen Sigil",
      "summary": "The duke's seal was taken before the peace summit.",
      "body": "Prepare motives and pressures, not a mandatory sequence.",
      "folderId": "arc-glass-crown",
      "tags": ["court", "investigation"],
      "state": "ready",
      "pinned": true,
      "sections": [
        {
          "id": "audience-with-duke",
          "title": "Audience with the Duke",
          "body": "Mira requests discretion."
        }
      ]
    }
  ],
  "links": [
    {
      "id": "link-mira-sigil-audience",
      "schemaVersion": 1,
      "operation": "create",
      "name": "Requests a discreet investigation",
      "type": "involves",
      "source": {
        "scope": "core",
        "collection": "characters",
        "id": "mira-vel"
      },
      "target": {
        "scope": "planning",
        "itemId": "quest-stolen-sigil",
        "sectionId": "audience-with-duke"
      },
      "notes": ""
    }
  ]
}
```

Replace `mira-vel` with an actual character id from the target campaign.

## Large structures and ordered batches

One atomic import can write at most 256 records across folders, items, and
links. For a larger structure:

1. Batch 1 creates parent folders and independent items.
2. Later batches create child folders and additional items.
3. Final batches create links after all their planning endpoints exist.

Each batch must be valid against the data that already exists before that
batch. Do not split a newly created item and a link to that item into the wrong
order. A failed batch changes nothing; previously committed batches remain.

Prefer coherent batches over filling the maximum mechanically. Tell the DM the
required order and what each batch adds.

## Generation quality rules

- Model possibilities, pressures, NPC motives, encounter setups, and world
  relationships. Do not prescribe the players' path through them.
- Keep historical/session bookkeeping minimal unless the DM specifically asks
  for it.
- Use a named section for a specific quest part that needs NPC, location,
  faction, encounter, or revelation links.
- Use one canonical planning item for one concept. Express reuse and
  relationships with links instead of duplicating text.
- Keep folder hierarchy shallow. Folders are navigation, not story logic.
- Give every link a concrete name that reads well as a graph edge.
- Use `related` only when the other five relations do not fit.
- Do not duplicate core NPCs, locations, factions, mysteries, artifacts, or
  events as planning notes merely to make them visible. Link the real record.
- Keep optional addon references external. Do not make another addon a hard
  dependency just to show a link.
- Preserve user-authored text and stable ids during updates.

## Validation checklist

Before returning a document, verify:

- the envelope contains only the six documented fields;
- `generatedAt` is an epoch-millisecond integer;
- every record has schema version 1 and a valid operation;
- each update has the exact current `expectedUpdatedAt`;
- ids are unique inside their collection;
- folder parents exist and form no cycle;
- item folders exist;
- section ids are unique inside their item;
- every planning item and section endpoint exists;
- every core endpoint uses a verified campaign id;
- no link connects an endpoint to itself;
- every link has a useful name and an allowed relation type;
- the document proposes at most 256 writes;
- the JSON contains no comments, trailing commas, duplicate keys, HTML, or
  executable instructions.

## Prompt template for another agent

> Generate a DM Tools planning import using schema version 1 from
> `docs/AGENT_GENERATION.md`. Model forward-looking D&D planning and
> world-building, not session scripts or extensive retrospective notes.
> Preserve the supplied ids and current `updatedAt` values. Use named sections
> whenever an NPC or other entity must link to a specific part of a quest.
> Use verified core ids only. Return strict JSON plus a short list of omitted
> unresolved references. If more than 256 records would change, return ordered,
> independently valid batch files.
