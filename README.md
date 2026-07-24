# DM Tools

DM Tools is an API-v2 addon for
[ttrpg-codex](https://github.com/pjunak/ttrpg-codex). The initial F1 release
is a security-contract reference consumer: it declares one host-managed,
DM-only collection and no user interface.

## Current contract

- Addon id: `dm-tools`
- Host API: v2
- Required host capabilities: `collections.dm`, `lifecycle.dispose`
- Permission: `data:own`
- Collection: `scenarios` (list-shaped, `access: "dm"`)
- Storage: `data/addon-data/dm-tools/scenarios.json`

Only an effective DM registers and accesses the collection. A real player,
anonymous visitor, or DM using view-as-player receives no collection data or
collection metadata, and server-side guessed writes are rejected without
revealing whether the collection exists.

This repository intentionally contains no scenario editor, import flow, graph,
dashboard, planner, transaction, or localization-package implementation yet.

## Test and install

From this repository:

```powershell
node --test tests\smoke.mjs
```

From the sibling host repository:

```powershell
node scripts\dev-install-addon.cjs ..\dm-tools
```
