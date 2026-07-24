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

The current F2 scope remains limited to the DM-only, list-shaped `scenarios`
collection plus a minimal transaction smoke case. Do not add scenario UI,
imports, graph features, dashboard ownership, planners, speculative
collections, or localization packages until their host contracts land in
later batches.

Develop against the sibling host:

```powershell
node ..\ttrpg-codex\scripts\dev-install-addon.cjs .
node --test tests\smoke.mjs
```

Inspect and preserve existing changes. Do not create branches, stage, commit,
or push unless the maintainer asks.
