# DM Tools

DM Tools is the planning and world-building addon for
[ttrpg-codex](https://github.com/pjunak/ttrpg-codex). It gives the effective DM
one nested story canvas and one reviewed import workflow over the same model.

The planner is deliberately forward-looking. It helps a DM organize plotlines,
quests, story events, encounters, puzzles, decisions, conditions, world
references, intended consequences, and separate table notes. It does not track
which branch is active, mark quests complete, prescribe sessions, or require a
play log.

It contributes a compact overview to the host-owned `/dm` dashboard. Character
Sheets and compendiums remain optional and independently useful.

## Story model

Ownership is a tree:

```text
Campaign
├─ Plotline
│  ├─ Quest
│  │  ├─ nested Quest
│  │  ├─ Event (story, encounter, or puzzle)
│  │  └─ Branch (decision, condition, or random)
│  └─ Event / Branch / nested Plotline
└─ Quest / Event / Branch
```

Each open canvas shows only the direct children of its campaign, plotline, or
quest scope. Flow links are acyclic and independent from ownership. A flow that
crosses a deeper scope is summarized on the owning card until the DM enters
that canvas.

Single click selects a card and opens its inspector. Double-click enters a
plotline or quest, or opens the dedicated encounter/puzzle screen. Cards drag
to a 24 px grid. Pulling from a card’s edge creates an orthogonal flow link;
the same operation is available through labelled native controls.

## Data contract

All collections are host-managed and DM-only:

| Collection | Purpose |
|---|---|
| `planning_items` | Nested plotlines, quests, typed events, and branches. |
| `planning_flow_links` | Stateless directed story flow and branch options. |
| `planning_references` | Named links to campaign records, optional-addon records, or other plans; quantities support encounter participants. |
| `planning_consequences` | Planned world changes, rewards, information, and complications attached to an item or flow. |
| `dm_notes` | Separate marginalia linked to zero or more planning items. |
| `planning_views` | Per-scope card positions only; never planning meaning or import data. |

`scenarios`, `planning_folders`, and `planning_links` remain declared only as
non-destructive migration sources. The v2 migration translates compatible
records atomically, retains the originals, and does not mark itself complete
when any record cannot be translated safely.

The shared schema is [`planning-contract.js`](planning-contract.js). Import
behavior is documented in [`docs/IMPORTING.md`](docs/IMPORTING.md). Agents must
follow [`docs/AGENT_GENERATION.md`](docs/AGENT_GENERATION.md).

## Routes

- `#/dm-plans` — campaign story canvas; nested scopes and detail screens use
  path segments under the same route
- `#/dm-import` — preview, review, and atomically commit generated plans
- `#/dm` — host-owned DM shell containing the addon overview

Players, anonymous visitors, and DM-view-as-player receive neither these
surfaces nor their data.

## Import guarantees

Provider `(dm-tools, planning-json)` uses provider API 1 and planning schema
version 2. Preview is read-only. Commit publishes the exact reviewed plan
through one durable host transaction. Imports never delete, change canvas
positions, or overwrite a record with a stale `expectedUpdatedAt`. One document
may propose at most 256 writes.

The provider also serves as restricted campaign-bundle contributor
`(dm-tools, planning)`, so a reviewed campaign bundle can reserve core record
IDs and refer to them from DM Tools without granting the addon core-write
authority.

## Test and install

From this repository:

```powershell
node --test tests/*.mjs
```

From the sibling host repository:

```powershell
node scripts/dev-install-addon.cjs ../dm-tools
```

This release changes server providers and declared collections, so reinstall,
restart the host, and refresh the browser. A production update that introduces
new permissions must use the per-addon installation wizard.

## License

The original software and documentation in this repository are licensed under
the [MIT License](LICENSE).
