# AGENTS.md — dm-tools

DM Tools is the API-v2 planning and world-building addon for the sibling
`ttrpg-codex` host. Its manifest id is the permanent storage namespace.

## Start here

Read only the references relevant to the task:

1. [`README.md`](README.md) for product scope and current surfaces.
2. [`planning-contract.js`](planning-contract.js) before changing stored data.
3. [`docs/IMPORTING.md`](docs/IMPORTING.md) before changing import behavior.
4. [`docs/GRAPH.md`](docs/GRAPH.md) before changing graph projection/lifecycle.
5. [`docs/AGENT_GENERATION.md`](docs/AGENT_GENERATION.md) before generating or
   changing the LLM interchange format.
6. `../ttrpg-codex/examples/addons/AGENTS.md` for the public host contract.
   Read host internals only when the public contract is insufficient.

## Module ownership

```text
addon.json                   capabilities, permissions, collections
entry.js                     composition and role-conditioned registration
planning-contract.js         shared pure schema and dataset validation
planning-migration.js        non-destructive legacy scenario copy
planning-workspace.js        manual item/folder/section/link editor
planning-graph-model.js      pure projection, identities, and fallback positions
planning-graph.js            graph workbench, inspector, persistence, lifecycle
dashboard.js                 live dm:dashboard planning overview
import-center.js             reviewed import state machine and UI
server/index.cjs             server composition
server/planning-provider.cjs multi-collection schema-v1 provider
server/scenario-provider.cjs retained legacy provider
locales/                     English source and Czech translation
tests/                       contract, provider, UI, graph, dashboard
```

## Product boundaries

- Build rich forward-looking D&D plans and world relationships. Do not make
  session scripts, automatic progress tracking, or extensive retrospective
  bookkeeping mandatory.
- Folders are navigation. Story meaning lives in planning items, stable named
  sections, and named semantic links.
- A link uses one fixed relation type plus a custom edge name. NPCs and other
  core entities may target an entire item or a specific section.
- `planning-contract.js` is the single validation contract for manual edits,
  migration, import, and tests. Do not create a parallel schema.
- Manual editing and imported structures must remain interchangeable.
- Keep Character Sheets, compendiums, and future homebrew addons optional.
  External endpoints store identity and a fallback label without requiring the
  referenced addon.
- The host owns `/dm`, authorization, diagnostics, persistence, transactions,
  import jobs, and the graph implementation. DM Tools owns only its
  contributions.

## Correctness boundaries

- Register DM-only collections and UI only for an effective DM.
- Preview is deterministic and read-only. Commit uses the exact server-held
  plan. Conflicts require a corrected source and a new preview.
- The planning provider is also the `planning` campaign-bundle contributor.
  It may resolve host-reserved core references during preview, but its returned
  operations remain confined to the three DM-only planning collections.
- Updates use epoch-millisecond `expectedUpdatedAt`; never silently merge or
  overwrite newer records.
- Legacy migration is copy-only. Do not delete `scenarios` without explicit
  maintainer approval after verifying the new records.
- The graph reflects stored links only. Never infer edges from tags, folders,
  timestamps, or prose.
- Keep graph presentation state in `planning_views`; positions must never
  become planning semantics or enter the import format.
- Collapsed section links must retain their named edge on the parent item;
  expanded views must target the exact section node.
- Clean up every scheduled mount, request, timer, subscription, and graph
  handle on navigation, role change, disposal, and late completion.
- Escape dynamic and translated text at every HTML boundary. Use host actions,
  announcements, component classes, and design tokens.
- English is authoritative. Czech must preserve catalog value shapes and
  placeholders.
- Write self-documenting code. Comments explain only non-obvious constraints
  or why an obvious approach is unsafe.

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
transaction, lifecycle, graph, slot, authorization, and visibility tests when
their contracts change.

Do not create branches, stage, commit, push, release, or deploy unless the
maintainer asks. The only durable suite backlog is
[`../ttrpg-codex/docs/BACKLOG.md`](../ttrpg-codex/docs/BACKLOG.md). Temporary
implementation plans belong only in the host's ignored `docs/plans/` directory
and must be deleted when the task closes.
