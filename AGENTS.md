# AGENTS.md — dm-tools

This repository contains the API-v2 `dm-tools` addon for the sibling
`ttrpg-codex` host. The manifest ID is the permanent collection namespace.

DM Tools deliberately has one small domain: DM-only scenarios. It supplies the
normal scenario content for the host-owned `/dm` shell, a reviewed JSON import
workflow, and a read-only graph view. Do not turn it into a second host core.

## Read before editing

1. [`README.md`](README.md) for the current product surface.
2. [`docs/IMPORTING.md`](docs/IMPORTING.md) before changing scenario data or
   imports.
3. [`docs/GRAPH.md`](docs/GRAPH.md) before changing graph mapping/lifecycle.
4. `../ttrpg-codex/examples/addons/AGENTS.md` for the host contract.
5. `../ttrpg-codex/docs/reference/addons.md` for host internals only when the
   public authoring contract is insufficient.

## Architecture

```text
addon.json                  API-v2 authority and scenarios declaration
entry.js                    composition root and role-conditioned registration
dashboard.js                live scenario contribution to dm:dashboard
import-center.js            DM-only import workflow state machine and UI
scenario-graph.js           read-only graph/list projection and cleanup
server/index.cjs            server composition root
server/scenario-provider.cjs deterministic provider validation/planning
locales/en.json             complete English source catalog
locales/cs.json             Czech translation catalog
tests/                      registration, provider, import, graph, dashboard
```

## Non-negotiable boundaries

- The only collection is list-shaped `scenarios` with `access: "dm"`.
- Register collection access, routes, sidebar entries, actions, dashboard
  content, and graph UI only for an effective DM.
- The host retains `/dm`, authorization, addon diagnostics, and recovery
  fallback. DM Tools owns only the `dm:dashboard` contribution.
- Preview is deterministic and read-only. Commit uses the exact server-held
  plan through the host transaction service.
- Conflicts never overwrite. A corrected source and new preview are required.
- Scenario JSON is a versioned replacement schema, not a permissive patch
  format. Preserve diagnostic codes and paths as user-visible contracts.
- Import state explicitly represents validation, preview, review, commit,
  completion, failure, cancellation, expiry, and revision conflict.
- A lost commit response is recovered through job status; never resubmit it
  automatically.
- The graph reflects only stored facts. Because scenarios have no relationship
  field, it has no edges and must not infer them from tags, order, or time.
- Every scheduled mount, request, timer, and graph handle has idempotent
  cleanup. Role changes, navigation, disposal, and late responses must not
  revive stale UI.
- Escape dynamic and translated strings at HTML boundaries. Use host actions,
  announcements, component classes, and design tokens.
- English is the source catalog; Czech must preserve value shapes and
  placeholders.

## Optional-addon posture

DM Tools depends on host capabilities, not on sheets or the compendium. It must
remain useful when neither D&D addon is installed. Conversely, those addons
must not depend on DM Tools.

Keep scenario editors, inferred planning, additional collections/providers,
and generalized graph mappings out of scope until a concrete versioned domain
requirement justifies them.

## Working loop

Run from this repository in PowerShell:

```text
node --test tests/smoke.mjs tests/provider.mjs tests/import-center.mjs tests/scenario-graph.mjs tests/dashboard.mjs
```

From the host repository:

```text
node scripts/dev-install-addon.cjs ../dm-tools
```

Server-provider changes require reinstall, host restart, and browser refresh.
Test effective-DM behavior plus real player, anonymous, and view-as-player
denial. Run relevant host import, transaction, lifecycle, graph, slot, and
authorization tests when those contracts change.

Development happens on `main`. Do not create branches, stage, commit, release,
or push unless the maintainer asks. The only durable suite backlog is
[`../ttrpg-codex/docs/BACKLOG.md`](../ttrpg-codex/docs/BACKLOG.md). Temporary
implementation plans belong only in the host repository's ignored
`docs/plans/` directory and must be deleted when the task closes. Do not create
repo-local TODO, roadmap, or planning files.
