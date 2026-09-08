# Reviewed planning imports

DM Tools owns the visible provider-neutral Import Center and one
`codex.import-adapter` v2 provider for `dm-tools-planning`.

The browser reads at most 2 MiB, parses the root object, and examines only its
string `format`. Exactly one discovered adapter must claim that format. The
complete document then crosses the broker to that provider for authoritative
validation.

The chooser, supported-format rows, document/provider strip, and review ledger
follow the preserved pre-rewrite Import Center. One file picker also accepts a
dropped JSON file. Filename, selected format, provider, mode, create/update/
unchanged/delete counts, warnings, and expandable record identities remain
visible before submission. The Import Center's controls and status/error text
use English/Czech catalogs; provider-authored labels, descriptions, warnings
and imported content remain the provider's text.

Discovery requests run independently. Failed providers are named without hiding
healthy ones; **Refresh available formats** retries discovery, including an
empty or failed result. Duplicate format claims block only that format, and
the UI never chooses a provider by its add-on ID. Invalid JSON, missing/unknown
formats, oversized files and invalid reviews cannot enable Commit. The browser
checks that the review matches the selected format and that listed operations
agree with its summary, in addition to the broker's schema validation.

The browser opts into its own declared worker with `includeOwn: true` while
keeping other adapters selected through their advertised formats. This does not
add a worker self-dependency. Every worker import method requires a host-issued
DM actor, including read-only preview and description.

Leaving the Import Center aborts its outstanding discovery/preview/request and
discards the visible review. Late responses cannot repopulate a detached or
replaced page. **Cancel preview** also cancels a pending read-only preview and
discards an unsubmitted review without writing;
server-held unused tokens remain bounded by their expiry and plan limit.

Submission removes the visible single-use token immediately. A conflict requires
a fresh reviewed preview. If the response is lost or otherwise uncertain, inspect
planning data before previewing again: cancelling a request cannot undo an
already completed transaction. An unchanged host context does not reset a review.
Language-only context changes also preserve the exact review. While Commit is
pending, the contribution reports a save to the host's navigation/unload guard;
the page cannot offer another submission. Forced generation/authority teardown
still cancels the local request. **Choose another document** clears the displayed
outcome without claiming that a completed or uncertain commit was cancelled.

Installed host checks use both the real planning package and an independent
native provider. They cover provider-owned writes, duplicate claims, partial
and complete discovery failure/retry, malformed reviews, cancellation, pending
commit navigation, content escaping, and desktop/phone English/Czech rendering.

## Planning workflow

The Go worker:

1. strictly parses schema-v3 records and rejects unknown or missing fields;
2. loads all six planning collections and pins each collection's paginated
   reads to its initial host revision;
3. reconciles create, update, identical skip, and replacement deletion;
4. validates ownership, anchors, references, same-parent flow, and cycles over
   the complete candidate;
5. retains at most 256 exact mutations and all six collection revisions behind
   a random 15-minute token.

Preview never writes. Commit requires an idempotency key, consumes the token
once, and submits the retained mutations and collection guards in one host
transaction. Exact record revisions and the original collection revisions make
a concurrent planner change fail as a conflict, even for records absent from
the review. The worker does not rerun reconciliation, refresh accepted guards,
or silently merge newer data. A host without collection revisions cannot preview
an import. Read-only empty plans do not issue a transaction.

`merge` retains omitted records and never touches `planning_views`. `replace`
requires every incoming record to use `create`, deletes omitted semantic
records, and clears saved layouts. The preview lists those deletions and the UI
uses an explicit destructive confirmation label.

There is no permanent import path for older planning schemas. The supervised
rewrite cutover uses a separate one-time campaign converter and the downloaded
site backups as rollback evidence.
