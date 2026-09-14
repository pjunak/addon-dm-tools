# AGENTS.md — addon-dm-tools

DM Tools is an Add-on API v3 TypeScript/Go package for the sibling
`ttrpg-codex` host. Its add-on ID and six collection IDs are permanent campaign
data namespaces.

## Read by task

Use documentation as an index; load the relevant guide and its owning schemas
before changing code or generating a document.

| Task | Start here |
| --- | --- |
| Setup, commands or package boundaries | [README.md](README.md) |
| Use or explain the planner | [Planner guide](docs/PLANNER.md) |
| Create importable story context from notes, conversation or an agent brief | [Content-generation guide](docs/AGENT_GENERATION.md), including its context brief and worked examples |
| Prepare an update, review an import, or change preview/commit | [Import Center guide](docs/IMPORTING.md) |
| Change ownership, flow, annotations, layout, drafts or persistence | [Graph contract](docs/GRAPH.md) and the relevant [schemas](contracts/) |
| Change the planning JSON format | Content-generation and Import Center guides, schemas, Go importer and documented-example tests |
| Change host integration, manifests, permissions or lifecycle | [Public Add-on API](../ttrpg-codex/examples/addons/API_V3.md) |

Sibling links assume adjacent checkouts. In an independent checkout, locate
compatible public contracts when needed. Do not assume parent workspace
instructions were loaded or read unrelated sibling implementations.
Go builds require the compatible sibling host SDK replacement in
[go.mod](go.mod); this does not make host internals part of this add-on.

## Creating importable content

- Start from the requested story scope, known campaign facts, permitted invention
  and preservation requirements. Use the guide's brief to identify missing
  context. Continue independent work while a required identity or baseline is
  unavailable; never invent an existing record ID, timestamp or validation result.
- Use current authorized records for existing parents, targets and updates.
  Include enough surrounding graph to reason about ownership and flow.
  Keep secrets and unrelated campaign dumps out of the authoring context.
- Default to a reviewable merge. An update is a complete record: preserve every
  field outside the requested edit and use its exact stored timestamp. Do not
  use empty values as placeholders for text that should survive.
- Model ownership before local flow. Keep proposed outcomes conditional and
  distinguish new fiction from established facts. References and consequences
  do not create core records, apply rewards or change character sheets.
- Never switch to replacement to bypass a conflict. Complete replacement needs
  explicit scope and a clear explanation that omitted semantic records and all
  layouts are deleted. Follow the user's existing authorization; do not invent
  an additional approval checkpoint.
- Deliver the JSON separately from assumptions, change scope and validation
  results. Check the actual candidate, not just a similar sample. Syntax checks
  and repository fixture tests do not prove that a user document will preview
  against current campaign data.
- Preparing a file or obtaining a preview is not authorization to commit it.
  Apply only within the user's authorized scope. If the commit outcome is
  uncertain, inspect current data before another attempt.

## Implementation ownership and invariants

The [graph contract](docs/GRAPH.md#code-and-schema-ownership) maps modules to
responsibilities. Keep browser persistence in `src/planning-repository.ts`,
authoritative import validation in `internal/planning`, and retained preview
plans in `internal/importer`. The provider-neutral Import Center routes only
through advertised formats and broker handles.

`cmd/worker` is the native composition root. Stdout is reserved for framed RPC;
diagnostics go to stderr. JSON schemas under `contracts/` define activation and
write boundaries.

- Planning schema version 3 is the only runtime format. Do not add a permanent
  legacy compatibility layer.
- Ownership is a tree; only plotlines and quests may contain children.
- Flow joins distinct existing immediate siblings, is acyclic, and starts at
  a branch when its kind is `option`.
- References, consequences and notes are annotations, not inferred flow.
  `planning_views` is presentation only and is never carried in an import.
- Browser writes use exact document and all six collection revisions.
  Subtree deletion and its cross-collection cleanup are one transaction.
- Preview is read-only and bounded to 256 mutations. Commit consumes the token
  and publishes the retained plan; it must not reconstruct it from the source.
- Unknown fields, old schemas, stale update timestamps and invalid stored data
  fail visibly. Report differences between intended and implemented validation
  instead of silently treating a defect as the intended contract.
- Services exchange serializable, schema-validated values, never DOM, functions,
  host facades or raw HTML.

## Release and installation

Successful main builds publish the inspected ZIP to a durable commit release;
the source commit identifies an update even when the manifest version stays the
same. Follow the [README installation guide](README.md#install-and-update-from-tested-commits).
Each site's owner chooses **Latest published package**, reviews permissions and
activates the package. Publication never installs it automatically.

The host image is deployed separately by `pjunak/infra`. This add-on has no
Compose deployment target or infra dispatch credential. Release publication uses
the workflow's repository-scoped job token; private downloads use host-managed
GitHub credentials. Preserve the reviewed package lifecycle on both sites.

## Working loop

For prose or agent-guidance changes, review the diff, check local links, and
verify changed commands and contract claims. Exercise documented JSON examples
through the real import parser/preview using synthetic data:

~~~text
go test ./internal/importer -run TestDocumentedPlanningExamples
~~~

That command validates repository examples. It does not preview arbitrary user
documents or contact a campaign.

For runtime/build changes, run the complete gate below. Install dependencies
when missing/stale, and run `npx playwright install chromium` when the required
browser is missing/stale. The gate includes a real-browser planner contract;
keep its fixture aligned with intentional card, flow and layout changes.

~~~text
npm run check
go test ./...
go vet ./...
go run ./cmd/build-package
~~~

Inspect the ZIP with the host inspector after package, manifest, worker or
schema changes. Regenerate distribution files through their owning build;
never hand-edit them. Reuse successful checks on unchanged inputs and preserve
CI/release gates. Do not push, deploy or convert live campaigns without explicit
instruction.
