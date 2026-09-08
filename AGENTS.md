# AGENTS.md — addon-dm-tools

DM Tools is an Add-on API v3 TypeScript/Go package for the sibling
`ttrpg-codex` host. Its add-on ID and six collection IDs are permanent campaign
data namespaces.

## Read by task

Sibling paths in this guide assume the named repositories are checked out
next to this one. For an independent checkout, locate the compatible public
host/consumer contracts only when needed; do not assume parent workspace
instructions were loaded or read unrelated sibling implementations. Go builds
use the sibling host replacement declared in go.mod; ensure that compatible
checkout exists before building, without importing its unrelated instructions.

1. [`README.md`](README.md) for setup, product behavior or commands.
2. [`docs/GRAPH.md`](docs/GRAPH.md) for planning-model, graph, layout or flow changes.
3. [`docs/IMPORTING.md`](docs/IMPORTING.md) before changing preview or commit.
4. [`docs/AGENT_GENERATION.md`](docs/AGENT_GENERATION.md) before changing the
   planning JSON source format.
5. [`../ttrpg-codex/examples/addons/API_V3.md`](../ttrpg-codex/examples/addons/API_V3.md)
   for changes to host integration, manifests, permissions or lifecycle.

## Ownership

- `src/planning-model.ts` owns browser-side projection and defensive invariant
  checks; `internal/planning` owns authoritative import normalization and
  complete-dataset validation.
- `src/planning-repository.ts` is the only browser persistence boundary.
- `src/planner-element.ts` owns the interactive DOM/SVG planner.
- `src/import-element.ts` is provider-neutral and routes only through declared
  adapter formats and broker handles.
- `internal/importer` owns server-held preview plans and exact single-use
  commit. It writes only package-owned collections through the host data API.
- `cmd/worker` is the native worker composition root. Stdout is reserved for
  framed RPC; diagnostics go to stderr.
- JSON schemas under `contracts/` are the activation and write boundary.

## Invariants

- Planning schema version 3 is the only accepted runtime format.
- Ownership is a tree. Only plotlines and quests may contain children.
- Every flow endpoint exists, differs, and has exactly the same immediate
  `parentId`. Planned flow is acyclic; option flow starts at a branch.
- References, consequences, and notes are annotations, not inferred flow.
- `planning_views` is presentation only and never imported in merge mode.
- Browser writes use exact revisions. Subtree deletion is one explicit
  cross-collection transaction.
- Import preview is read-only and bounded to 256 mutations. Commit consumes a
  single-use token and publishes the exact plan. Never reconstruct it from the
  source document at commit time.
- Unknown fields, old schema versions, stale timestamps, and invalid stored
  records fail visibly. Do not add a permanent legacy compatibility layer.
- Services exchange serializable schema-validated values. Never return DOM,
  functions, host facades, or raw HTML.

## Working loop

For prose or agent-guidance-only changes, review the diff, check local links,
and verify changed commands or contract claims. Runtime builds and operational
acceptance are required only for the affected behavior below. Reuse successful
checks on unchanged inputs; preserve complete CI and release gates.

For documentation examples, exercise the real import parser/preview using
synthetic data. For runtime/build changes, run the complete gate below.
Install dependencies when missing/stale and the planner rendering browser with
`npx playwright install chromium` when its installed version is missing/stale.
The complete gate includes a real-browser
contract for the current TypeScript planner; keep its fixture aligned with
intentional card, flow, or layout changes.

```powershell
npm run check
go test ./...
go vet ./...
go run ./cmd/build-package
```

Inspect the produced ZIP with the host inspector after package, manifest,
worker, or schema changes. Never push, deploy, or convert live campaigns
without explicit instruction.
