# AGENTS.md — addon-dm-tools

DM Tools is the API-v2 planning and world-building addon for the sibling
`ttrpg-codex` host. Its manifest id is the permanent storage namespace.

## Start here

Read only the references relevant to the task. Each document has one owner:

1. [`README.md`](README.md) for the human-facing product overview and local
   development commands.
2. [`planning-contract.js`](planning-contract.js) for the executable stored-data
   schema and complete-dataset validation.
3. [`docs/GRAPH.md`](docs/GRAPH.md) for canvas projection, local-flow semantics,
   interactions, and presentation-only view records.
4. [`docs/IMPORTING.md`](docs/IMPORTING.md) for preview, reconciliation,
   atomicity, and campaign-bundle behavior.
5. [`docs/AGENT_GENERATION.md`](docs/AGENT_GENERATION.md) for the exact planning
   JSON format produced by people or language models.
6. `../ttrpg-codex/examples/addons/AGENTS.md` for the public host contract.
   Read host internals only when the public contract is insufficient.

## Module ownership

```text
addon.json                       capabilities, permissions, collections
entry.js                         composition and role-conditioned registration
planning-contract.js             pure schema and complete-dataset validation
story-planner-model.js           ownership projection, layout, orthogonal paths
story-planner-interactions.js    pointer/keyboard drag and connection lifecycle
story-planner-render.js          escaped canvas, dock, modal, and detail HTML
story-planner-styles.js          addon-scoped host-token styles
story-planner.js                 planner state, CRUD, transactions, navigation
dashboard.js                     live dm:dashboard planning overview
import-center.js                 generic adapter discovery, selection, lifecycle
planning-import-adapter.js       reviewed planning import state machine and UI
server/index.cjs                 server composition
server/planning-provider.cjs     schema-v3 import provider and restricted
                                 campaign-bundle contributor
locales/                         English source and Czech translation
tests/                           contract, provider, UI, dashboard, lifecycle
```

## Product boundaries

- This is a forward-looking story planner, not a session script, quest tracker,
  campaign-state machine, or mandatory retrospective journal.
- Ownership is strict and tree-shaped: the campaign owns root items; plotlines
  and quests may own nested items; events and branches are leaves.
- The planner is a tree of local DAGs: ownership forms the tree, and each
  campaign/plotline/quest canvas owns an acyclic flow graph between its direct
  children. Flow never crosses scopes, changes ownership, or records what
  actually happened.
- `eventType` changes presentation and structured detail labels. Encounter and
  puzzle events open dedicated screens; story events remain concise beats.
- A branch is an explicit decision, condition, or random gate. It is not a
  generic event and it never stores a selected outcome.
- Consequences are planned annotations attached to an item or flow link. They
  do not mutate campaign state.
- DM marginalia is stored in `dm_notes`, separately from the plan, and may link
  to multiple planning items.
- Named references connect planning items to core records, optional-addon
  records, or another planning item. External identity plus fallback label must
  remain useful when that addon is absent.
- Character Sheets, compendiums, and future homebrew addons remain optional.
- Manual editing and reviewed generated imports use the same data contract.
- The visible Import Center belongs here. It composes `codex.import-adapter`
  services and must never branch on known addon ids or payload schemas.

## Correctness boundaries

- `planning-contract.js` is the only schema. Manual editing, import, and tests
  must not create parallel validators.
- Planning schema version 3 is the only supported version. Reject older stored
  records and import documents; do not translate or merge them.
- Every flow endpoint must exist, differ, and have exactly the same immediate
  `parentId`. Equal depth is insufficient. Reparenting must fail if it would
  strand an attached flow; never delete or retarget that flow implicitly.
- Named planning references, marginalia anchors, and consequence targets may
  cross ownership scopes because they are not canvas flow.
- Register all collections and UI only for an effective DM.
- Preview is deterministic and read-only. Commit uses the exact server-held
  plan. Conflicts require a corrected source and a new preview.
- Import adapters own their UI, actions, provider client, links, and cleanup.
  The center only validates descriptors, selects adapters, and contains errors.
- The server provider also contributes restricted `(dm-tools, planning)` data
  to reviewed campaign bundles. Keep its reserved core targets and planning
  references aligned with the schema and host bundle contract.
- Updates use epoch-millisecond `expectedUpdatedAt`; never merge or overwrite a
  newer record silently.
- `planning_items`, `planning_flow_links`, `planning_references`,
  `planning_consequences`, and `dm_notes` are planning meaning.
  `planning_views` is presentation only and never enters imports.
- Render only direct children and their real local flow on an open canvas.
  Never roll up or infer edges from nested content, ownership, prose, tags,
  proximity, or timestamps.
- Selection must update canvas styling and contextual actions without a route
  rerender so the canvas scroll position remains stable.
- Clean up every scheduled mount and DOM listener on rerender, navigation,
  role change, update, and disposal.
- Escape user and translated text at HTML boundaries. Markdown must use the
  host renderer. Use host actions, announcements, design tokens, and component
  classes; do not access host-private DOM or libraries.
- English is authoritative. Czech must preserve every key, value shape, and
  placeholder.
- Comments explain only non-obvious constraints or why an obvious approach is
  unsafe.

## Working loop

Run in PowerShell from this repository:

```text
node --test tests/*.mjs
```

Then from the host:

```text
node scripts/dev-install-addon.cjs ../addon-dm-tools
```

Server-provider changes require reinstall, restart, and refresh. Permission
additions require the per-addon production wizard. Run relevant host import,
transaction, lifecycle, slot, authorization, and visibility tests when their
contracts change.

The global Codex instructions govern task commits. Do not create branches,
push, release, or deploy unless the maintainer asks. The only durable suite
backlog is
[`../ttrpg-codex/docs/BACKLOG.md`](../ttrpg-codex/docs/BACKLOG.md). Temporary
implementation plans belong only in the host's ignored `docs/plans/` directory
and must be deleted when the task closes.
