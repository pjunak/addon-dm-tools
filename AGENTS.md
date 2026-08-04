# AGENTS.md — dm-tools

DM Tools is the API-v2 planning and world-building addon for the sibling
`ttrpg-codex` host. Its manifest id is the permanent storage namespace.

## Start here

Read only the references relevant to the task:

1. [`README.md`](README.md) for product scope and current surfaces.
2. [`planning-contract.js`](planning-contract.js) before changing stored data.
3. [`docs/IMPORTING.md`](docs/IMPORTING.md) before changing import behavior.
4. [`docs/GRAPH.md`](docs/GRAPH.md) before changing the story canvas.
5. [`docs/AGENT_GENERATION.md`](docs/AGENT_GENERATION.md) before generating or
   changing the LLM interchange format.
6. `../ttrpg-codex/examples/addons/AGENTS.md` for the public host contract.
   Read host internals only when the public contract is insufficient.

## Module ownership

```text
addon.json                       capabilities, permissions, collections
entry.js                         composition and role-conditioned registration
planning-contract.js             pure schema and complete-dataset validation
planning-migration.js            non-destructive v1-to-v2 translation
story-planner-model.js           ownership projection, layout, orthogonal paths
story-planner-interactions.js    pointer/keyboard drag and connection lifecycle
story-planner-render.js          escaped canvas, inspector, and detail HTML
story-planner-styles.js          addon-scoped host-token styles
story-planner.js                 planner state, CRUD, transactions, navigation
dashboard.js                     live dm:dashboard planning overview
import-center.js                 generic adapter discovery, selection, lifecycle
planning-import-adapter.js       reviewed planning import state machine and UI
server/index.cjs                 server composition
server/planning-provider.cjs     schema-v2 import provider and restricted
                                 campaign-bundle contributor
locales/                         English source and Czech translation
tests/                           contract, migration, provider, UI, dashboard
```

## Product boundaries

- This is a forward-looking story planner, not a session script, quest tracker,
  campaign-state machine, or mandatory retrospective journal.
- Ownership is strict and tree-shaped: the campaign owns root items; plotlines
  and quests may own nested items; events and branches are leaves.
- Flow is a separate acyclic graph. It never changes ownership or records what
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

- `planning-contract.js` is the only schema. Manual editing, migration, import,
  and tests must not create parallel validators.
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
- `scenarios`, `planning_folders`, and `planning_links` are read-only migration
  sources. Do not add product behavior to them or delete their data without
  explicit maintainer approval.
- The v2 migration is atomic and non-destructive. A conflict writes neither
  translated data nor the completion marker.
- Render only direct children on an open canvas. Cross-scope flow is rolled up
  to the visible owning child; never infer edges from prose, tags, proximity,
  timestamps, or ownership.
- Selection must update the inspector without a route rerender so the canvas
  scroll position remains stable.
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
node scripts/dev-install-addon.cjs ../dm-tools
```

Server-provider changes require reinstall, restart, and refresh. Permission
additions require the per-addon production wizard. Run relevant host import,
transaction, lifecycle, slot, authorization, and visibility tests when their
contracts change.

Do not create branches, stage, commit, push, release, or deploy unless the
maintainer asks. The only durable suite backlog is
[`../ttrpg-codex/docs/BACKLOG.md`](../ttrpg-codex/docs/BACKLOG.md). Temporary
implementation plans belong only in the host's ignored `docs/plans/` directory
and must be deleted when the task closes.
