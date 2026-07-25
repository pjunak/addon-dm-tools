# DM Tools

DM Tools is an API-v2 addon for
[ttrpg-codex](https://github.com/pjunak/ttrpg-codex). It owns one
host-managed, DM-only `scenarios` collection, a DM-only Import Center for
reviewed scenario JSON imports, and a read-only scenario graph rendered
through the host's versioned graph facade. Its `dm:dashboard` contribution
owns the normal scenario workflow on the host's stable DM-only `/dm` route.

## Current contract

- Addon id: `dm-tools`
- Host API: v2
- Required host capabilities: `collections.dm`, `collections.transactions`,
  `lifecycle.dispose`, `i18n.catalogs`, `imports.providers`, `graphs.facade`
- Permissions: `data:own`, `data:import-provider`, `server:code`, `ui:route`,
  `ui:sidebar`, `ui:action`, `ui:graph`, `ui:slot:dm`
- Collection: `scenarios` (list-shaped, `access: "dm"`)
- Storage: `data/addon-data/dm-tools/scenarios.json`
- Route: `#/dm-import`
- Graph route: `#/dm-scenarios`
- Dashboard slot: `dm:dashboard`
- Provider: `(dm-tools, scenario-json)`, provider API 1, schema version 1

Only an effective DM registers and accesses the collection. A real player,
anonymous visitor, or DM using view-as-player receives no collection data or
collection metadata, and server-side guessed writes are rejected without
revealing whether the collection exists.

The Import Center uploads through the host's ephemeral import-job service.
Preview is read-only, commit uses the exact server-held plan through the
atomic collection transaction service, and one
successful import produces one logical revision/event. Commit requires an
explicit review checkbox. Conflicts and invalid records block commit; revision
conflicts require a new preview. If a commit response is lost, the page checks
the owner-bound job result and never resubmits automatically.

The JSON schema and create/update/skip/conflict policy are documented in
[docs/IMPORTING.md](docs/IMPORTING.md). English is the source UI catalog and
Czech is supplied in `locales/cs.json`.

The graph mapping and cleanup contract are documented in
[docs/GRAPH.md](docs/GRAPH.md). The host retains `/dm` authorization,
diagnostics, and recovery fallback. Planners, generalized mappings, additional
providers, and speculative collections remain out of scope.

## Test and install

From this repository:

```powershell
node --test tests\smoke.mjs tests\provider.mjs tests\import-center.mjs tests\scenario-graph.mjs tests\dashboard.mjs
```

From the sibling host repository:

```powershell
node scripts\dev-install-addon.cjs ..\dm-tools
```
