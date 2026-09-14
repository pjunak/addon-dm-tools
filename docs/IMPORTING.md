# Using the Import Center

Use the Import Center to review a JSON document before it changes campaign
data. DM Tools supplies the page and its planning importer; other installed
providers can advertise their own formats.

For creating a planning document, start with
[Generating importable planning content](AGENT_GENERATION.md). For editing
saved plans, see the [planner guide](PLANNER.md).

## Import a planning document

1. Sign in as DM and open **Import Center** from the DM overview.
2. Check **Supported document types**. The planning provider advertises
   `dm-tools-planning`. Use **Refresh available formats** if a newly enabled
   provider is missing or discovery failed.
3. Choose or drop one JSON file. The page reads its `format`, finds its provider
   and requests a preview. Selecting a file does not write anything.
4. Review the filename, provider, mode, create/update/unchanged/delete counts,
   warnings and affected record identities.
5. Choose **Commit reviewed import** to apply the plan, or **Cancel preview** to
   leave the campaign unchanged. A preview with deletions instead names the
   deletion count in **Commit replacement with … deletions**.
6. After confirmed success, open the planner and inspect the affected items.
   **Choose another document** clears the result and returns to the chooser.

The ledger identifies records and operations; it does not display a field-by-field
or prose diff. Read the proposed document and compare existing records before
committing updates. An empty warning list does not establish narrative quality,
correct campaign references or appropriate deletion scope.

The chooser accepts one JSON file up to 2 MiB. Individual record and host
transport limits also apply; a file below that size is not guaranteed to pass.
There is no paste box in this page. Save generated JSON as a UTF-8 file without
Markdown fences or surrounding commentary.

## What planning imports can change

A `dm-tools-planning` document creates or updates plotlines, quests, events,
branches, story flow, references, planned consequences and DM notes. It does not
create core characters, locations, factions or other campaign records, execute
rewards, or change character-sheet mechanics.

References can point to existing campaign or external add-on records. Obtain
their exact identities first. Preview validates their shape but does not check
that core/external targets exist or remain accessible. Those references do not
grant access to their targets. Planning targets on both references and
consequences must exist in the resulting dataset, either already stored or
included in the same import. If replacement removes a planning item, explicitly
omit or replace its target on each retained consequence while preserving the
rest of that annotation. Preview rejects dangling targets without changing data.

Only formats advertised by available providers are supported. A character
transfer belongs in the character workspace; a full backup belongs in the host's
[backup and recovery workflow](../../ttrpg-codex/docs/SELF_HOSTING.md#backups).
Do not rename a document's `format` to make the planning importer accept it.

## Merge and replacement

| Behavior | `merge` — default | `replace` — complete planning snapshot |
| --- | --- | --- |
| Omitted planning records | Retained | Deleted |
| Included records | Explicit `create` or `update` | All entries use `create`; existing IDs are reconciled |
| Existing fields in an update | Replaced by the complete incoming record | Replaced by the complete incoming record |
| Saved canvas layouts | Preserved | All cleared, even if semantic records are unchanged |
| Deletion scope | No per-record delete operation | All omitted records in this add-on's five semantic collections |

**Replacement can delete unrelated stories, notes and all saved layouts in the
campaign's DM Tools dataset. It is not limited to the currently open plotline or
canvas.** An empty replacement can remove everything in that scope. Use it only
for an explicitly intended complete replacement, with a recovery copy.

Merge protects omitted records, not omitted text inside an included update.
Sending an empty `body`, `notes` or `tags` field replaces its existing value.
The generator must preserve every field outside the requested edit.

Use the planner's reviewed deletion action for a targeted deletion. Its
**Undo last deletion** applies to a planner deletion during the mounted session;
it is not an undo button for an import. For import recovery, use an appropriate
host recovery point or verified backup and review that restoration's scope.

## Updates and timestamps

Every entry has an `operation`. For merge:

- **Create:** omit `expectedUpdatedAt`. A new ID is created; an existing ID
  with equivalent content is unchanged; a different existing record conflicts.
- **Update:** provide the exact stored `expectedUpdatedAt`, even if the content
  is unchanged. A missing record or stale timestamp fails.
- A changed update also needs a root `generatedAt` later than the stored
  `updatedAt`. Equivalent content with a correct expected timestamp is unchanged.

The root timestamp becomes `updatedAt` for changed records. It is epoch
milliseconds, not an ISO date or seconds. It is separate from the host's
optimistic record revision. Never substitute one for the other.

An update is a complete record, not a patch. To prepare one, read the current
record, retain its fields and ID, make the requested changes, and attach the
observed timestamp. Example timestamps are fixtures, not values for a campaign.

## Failed, expired or uncertain imports

| Situation | Next step |
| --- | --- |
| Invalid JSON, unknown field or unsupported schema | Correct the document; do not remove `format` or guess another version |
| Unsupported format | Enable the intended provider and refresh discovery |
| More than one provider claims a format | Resolve the ambiguity; the page will not choose arbitrarily |
| Some providers fail discovery | Healthy formats remain usable; refresh to retry the failed providers |
| Stale record or collection conflict | Inspect current data, revise the candidate and request a fresh preview |
| Preview expired or worker replaced | Request and review a new preview |
| More than 256 planned writes/deletes | Use smaller coherent merge batches; every intermediate dataset must be valid |
| Commit response lost or uncertain | Inspect saved planning data before another preview or submission |

A preview lasts 15 minutes in its worker generation. Commit consumes its token,
including when a write fails with a conflict. An idempotency key is required at
the service boundary, but it does not make that consumed token replayable.

Canceling an unsubmitted preview writes nothing. Canceling a network request
after submission cannot undo a transaction that already completed. While a commit
is pending, the page prevents another submission and asks the host to guard
navigation. Forced package or authority teardown may still cancel the local
request; resolve its outcome from saved data.

## How the implementation protects a review

The browser routes by the root `format`, never by a guessed provider ID.
Each provider owns its validation and writes. DM Tools requires a host-issued
DM actor for description, preview and commit.

The planning worker reads all six collections with revision-pinned pagination,
normalizes the incoming records and validates the complete candidate. It retains
at most 256 exact mutations and all six opening collection revisions behind the
preview token. Commit submits those retained mutations in one guarded host
transaction; it does not rebuild the plan or refresh its guards.

A change anywhere in the planning dataset, including a layout changed in another
canvas, can invalidate the preview. This protects against unseen children and
new references as well as edits to listed records. An empty plan issues no
transaction. Invalid stored planning data must be repaired explicitly; importing
does not silently discard it. This includes dangling consequence targets saved
by older builds: the planner and importer report the affected consequence IDs
and leave their text intact. Before upgrading a campaign with that error,
preserve a verified backup and arrange an explicit correction of those records;
neither replacement import nor this update is an automatic repair procedure.

Leaving the page cancels local work and discards its visible review. Unchanged
host context and language-only changes preserve it. Controls use English/Czech
catalogs; provider descriptions and authored content retain their own language.

The [service schemas](../contracts/import-adapter.service.json),
[worker](../internal/importer/handler.go) and
[graph contract](GRAPH.md) define the technical boundaries.
