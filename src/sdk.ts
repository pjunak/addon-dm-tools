export interface AddonDocument<T> { readonly key: string; readonly revision: number; readonly value: T }
export interface QueryResult<T> { readonly documents: readonly AddonDocument<T>[]; readonly nextCursor?: string }
export type DataKind = "collection" | "record-extension";
export type DataMutation =
  | { readonly operation: "put"; readonly kind: DataKind; readonly dataId: string; readonly key: string; readonly expectedRevision: number; readonly value: unknown }
  | { readonly operation: "delete"; readonly kind: DataKind; readonly dataId: string; readonly key: string; readonly expectedRevision: number };
export interface CommitReceipt { readonly results: readonly { readonly dataId: string; readonly key: string; readonly afterRevision: number; readonly deleted: boolean }[] }
export interface CollectionHandle<T> {
  query(options?: { readonly cursor?: string; readonly limit?: number; readonly signal?: AbortSignal }): Promise<QueryResult<T>>;
  put(key: string, value: T, expectedRevision: number, options?: { readonly signal?: AbortSignal }): Promise<CommitReceipt>;
  delete(key: string, expectedRevision: number, options?: { readonly signal?: AbortSignal }): Promise<CommitReceipt>;
}
export interface ServiceProvider { readonly addonId: string; readonly contractVersion: string; readonly generation: string; readonly bindingRevision: number }
export interface ServiceHandle {
  readonly available: boolean;
  readonly providers: readonly ServiceProvider[];
  call<T>(method: string, params: unknown, options?: { readonly providerAddonId?: string; readonly deadlineMs?: number; readonly idempotencyKey?: string; readonly signal?: AbortSignal }): Promise<T>;
}
export interface AddonContext {
  readonly addon: { readonly id: string; readonly version: string; readonly generation: string };
  readonly signal: AbortSignal;
  readonly capabilities: { require(id: string): void };
  readonly data: {
    collection<T>(id: string): CollectionHandle<T>;
    transact(mutations: readonly DataMutation[], options?: { readonly signal?: AbortSignal }): Promise<CommitReceipt>;
  };
  readonly services: { connect(contract: string, options: { readonly range: string; readonly cardinality: "many"; readonly signal?: AbortSignal }): Promise<ServiceHandle> };
  readonly ui: { bind(id: string, binding: { readonly kind: "element"; readonly tag: string }): { dispose(): void } };
}
export interface ContributionContext {
  readonly addon: { readonly id: string; readonly generation: string };
  readonly contribution: { readonly id: string; readonly config: Readonly<Record<string, unknown>> };
  readonly signal: AbortSignal;
  readonly host?: unknown;
}
export interface Disposable { dispose(): void | Promise<void> }
