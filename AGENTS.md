# DM Tools add-on

DM Tools is a TTRPG Codex add-on (TypeScript UI plus a native Go worker) for
private story planning, the Atlas and the Import Center. Its add-on ID and six
collection IDs are permanent campaign data namespaces.

This is a personal project: preserve planning data first, then keep the UI
friendly and the code clear. Old formats and extra hardening are low priority.

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
| Change host integration, manifests, permissions or lifecycle | The host's [add-on guide](https://github.com/pjunak/ttrpg-codex/blob/main/examples/addons/AUTHORING.md) and [API reference](https://github.com/pjunak/ttrpg-codex/blob/main/examples/addons/API_V3.md) |

The repository builds from a plain clone; the host's worker SDK is an ordinary
Go module requirement. Tasks for all repositories live in the host's
`docs/BACKLOG.md`.

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

## Working loop

```text
npm run check:fast        # source guard, types, Oxlint, Prettier, fast Go checks
npm run check             # build, unit and Chromium rendering tests, Go tests
go run ./cmd/build-package
go tool -modfile=go.tools.mod codex-addon-inspect dist/dm-tools-3.0.0.zip
```

Run `npx playwright install chromium` if the browser is missing. The Chromium
planner contract must follow intentional card, flow and layout changes.
`npm run check:go`, `check:workflows`, `check:vulnerabilities` and
`check:dependencies` run the remaining CI modes. To try a documented planning
example through the real importer:

```text
go test ./internal/importer -run TestDocumentedPlanningExamples
```

`web/`, `worker/` and `dist/` are ignored build output; never hand-edit them.
Inspect the ZIP after package, manifest, worker or schema changes. To work
against a local host change, use an uncommitted `go work init . ../ttrpg-codex`.

Successful `main` builds publish the inspected ZIP as a GitHub release; DMs
install it through Settings → Add-ons. Ask before pushing, deploying or touching
a live campaign.
