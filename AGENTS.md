# AGENTS.md — DM Tools

DM Tools is an API-v2 addon for the sibling `ttrpg-codex` host. Its addon id
is `dm-tools`; collection identity and storage are therefore scoped by that
manifest id, not by the repository folder.

Read the host contracts before changing the addon:

- `../ttrpg-codex/AGENTS.md`
- `../ttrpg-codex/docs/reference/addons.md`
- `../ttrpg-codex/examples/addons/AUTHORING.md`

Keep this repository in English and browser-native ES modules with no build
step. Request only permissions and capabilities actually used. All owned
collections must be declared in `addon.json`, and DM-only collections require
API v2 plus `collections.dm` in `capabilities.required`.

The addon owns the DM-only, list-shaped `scenarios` collection, the versioned
`scenario-json` provider, the DM-only `#/dm-import` workflow, and the read-only
`#/dm-scenarios` graph consumer. Import schema and conflict policy live in
`docs/IMPORTING.md`; graph mapping and lifecycle live in `docs/GRAPH.md`. The
`dm:dashboard` slot supplies the normal scenario dashboard while the host
retains `/dm` authorization, diagnostics, and recovery fallback. Do not add
scenario editors, planner workflows, generalized mapping, more providers, or
speculative collections.

Develop against the sibling host:

```powershell
node ..\ttrpg-codex\scripts\dev-install-addon.cjs .
node --test tests\smoke.mjs tests\provider.mjs tests\import-center.mjs tests\scenario-graph.mjs
```

Inspect and preserve existing changes. Do not create branches, stage, commit,
or push unless the maintainer asks.
