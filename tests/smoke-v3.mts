import test from "node:test";
import assert from "node:assert/strict";

void test("compiled entry binds planner and import routes and disposes idempotently", async () => {
  type BindingRecord = { id: string; binding: unknown; disposed: boolean };
  type ServiceConnection = {
    contract: string;
    options: { cardinality: string; includeOwn: boolean };
  };

  const oldHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  const oldCustomElements = Object.getOwnPropertyDescriptor(globalThis, "customElements");
  const definitions = new Map<string, unknown>();
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    writable: true,
    value: class {},
  });
  Object.defineProperty(globalThis, "customElements", {
    configurable: true,
    writable: true,
    value: {
      define: (name: string, constructor: unknown) => definitions.set(name, constructor),
      get: (name: string) => definitions.get(name),
    },
  });
  try {
    const compiledEntry = new URL("../web/index.js", import.meta.url);
    compiledEntry.searchParams.set("smoke-v3", "1");
    const { activate } = (await import(compiledEntry.href)) as {
      activate: (context: unknown) => Promise<{ dispose(): void }>;
    };
    const bindings: BindingRecord[] = [];
    const collections: string[] = [];
    let connection: ServiceConnection | undefined;
    const context = {
      addon: { id: "dm-tools", version: "3.0.0", generation: "a".repeat(64) },
      signal: new AbortController().signal,
      capabilities: {
        require: (id: string) =>
          assert.ok(
            ["data.transactions", "ui.contributions", "ui.markdown", "ui.controls.v1"].includes(id),
          ),
      },
      data: {
        collection: (id: string) => {
          collections.push(id);
          return {
            query: async () => ({ documents: [] }),
            put: async () => {},
            delete: async () => {},
          };
        },
        transact: async () => ({ results: [] }),
      },
      services: {
        connect: async (
          contract: string,
          options: { cardinality: string; includeOwn: boolean },
        ) => {
          connection = { contract, options };
          return { available: false, providers: [], call: async () => assert.fail("unused") };
        },
      },
      ui: {
        bind: (id: string, binding: unknown) => {
          const record = { id, binding, disposed: false };
          bindings.push(record);
          return {
            dispose: () => {
              record.disposed = true;
            },
          };
        },
      },
    };
    const disposable = await activate(context);
    assert.equal(collections.length, 6);
    assert.ok(connection);
    assert.equal(connection.contract, "codex.import-adapter");
    assert.equal(connection.options.cardinality, "many");
    assert.equal(connection.options.includeOwn, true);
    assert.deepEqual(
      bindings.map((entry) => entry.id),
      ["map.planning", "planner.route", "imports.route", "dashboard.slot"],
    );
    assert.ok(definitions.has(`dm-tools-planner-page-${context.addon.generation}`));
    assert.ok(definitions.has(`dm-tools-import-center-${context.addon.generation}`));
    disposable.dispose();
    disposable.dispose();
    assert.ok(bindings.every((entry) => entry.disposed));
  } finally {
    if (oldHTMLElement) Object.defineProperty(globalThis, "HTMLElement", oldHTMLElement);
    else Reflect.deleteProperty(globalThis, "HTMLElement");
    if (oldCustomElements) Object.defineProperty(globalThis, "customElements", oldCustomElements);
    else Reflect.deleteProperty(globalThis, "customElements");
  }
});
