import test from "node:test";
import assert from "node:assert/strict";

test("compiled entry binds planner and import routes and disposes idempotently", async () => {
  const oldHTMLElement = globalThis.HTMLElement; const oldCustomElements = globalThis.customElements; const definitions = new Map();
  globalThis.HTMLElement = class {}; globalThis.customElements = { define: (name, constructor) => definitions.set(name, constructor), get: name => definitions.get(name) };
  try {
    const { activate } = await import("../web/index.js?smoke-v3"); const bindings = []; const collections = []; let connection;
    const context = {
      addon: { id: "dm-tools", version: "3.0.0", generation: "a".repeat(64) }, signal: new AbortController().signal,
      capabilities: { require: id => assert.ok(["data.transactions", "ui.contributions", "ui.markdown"].includes(id)) },
      data: { collection: id => { collections.push(id); return { query: async () => ({ documents: [] }), put: async () => {}, delete: async () => {} }; }, transact: async () => ({ results: [] }) },
      services: { connect: async (contract, options) => { connection = { contract, options }; return { available: false, providers: [], call: async () => assert.fail("unused") }; } },
      ui: { bind: (id, binding) => { const record = { id, binding, disposed: false }; bindings.push(record); return { dispose: () => { record.disposed = true; } }; } },
    };
    const disposable = await activate(context);
    assert.equal(collections.length, 6); assert.equal(connection.contract, "codex.import-adapter"); assert.equal(connection.options.cardinality, "many"); assert.equal(connection.options.includeOwn, true);
    assert.deepEqual(bindings.map(entry => entry.id), ["map.planning", "planner.route", "imports.route", "dashboard.slot"]); assert.ok(definitions.has(`dm-tools-planner-page-${context.addon.generation}`)); assert.ok(definitions.has(`dm-tools-import-center-${context.addon.generation}`));
    disposable.dispose(); disposable.dispose(); assert.ok(bindings.every(entry => entry.disposed));
  } finally { if (oldHTMLElement === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = oldHTMLElement; if (oldCustomElements === undefined) delete globalThis.customElements; else globalThis.customElements = oldCustomElements; }
});
