// The host's public browser types live unchanged in src/codex/ (copied and
// checked by tools/codex-sdk.mts). This module only names them for DM Tools.
export type {
  AddonContext,
  AddonDocument,
  CommitReceipt,
  DataChange,
  DataHandle as CollectionHandle,
  DataKind,
  DataMutation,
  DataSetRevision,
  Disposable,
  QueryResult,
  ServiceHandle,
  ServiceProvider,
  ContributionElementContext as ContributionContext,
} from "./codex/browser-sdk.js";
