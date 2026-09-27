#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import type { Server } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

type Options = { root: string; fixture: string };

const mimeTypes = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".ts", "text/javascript; charset=utf-8"],
]);

function parseArgs(argv: string[]): Options {
  const options: Options = { root: ".", fixture: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name !== "--root" && name !== "--fixture") throw new Error(`Unknown argument: ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    if (name === "--root") options.root = value;
    else options.fixture = value;
    index += 1;
  }
  if (options.fixture === "") throw new Error("--fixture is required");
  return options;
}

function isContained(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

async function createStaticServer(root: string): Promise<Server> {
  const server = http.createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const requested = resolve(
        root,
        ...decodeURIComponent(url.pathname).split("/").filter(Boolean),
      );
      if (!isContained(root, requested) || !(await stat(requested)).isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const extension = extname(requested).toLowerCase();
      const body =
        extension === ".ts"
          ? stripTypeScriptTypes(await readFile(requested, "utf8"), {
              mode: "strip",
              sourceUrl: url.pathname,
            })
          : await readFile(requested);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes.get(extension) || "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  return server;
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
}

async function run({ root, fixture }: Options): Promise<void> {
  const absoluteRoot = resolve(root);
  const absoluteFixture = resolve(absoluteRoot, fixture);
  if (!isContained(absoluteRoot, absoluteFixture))
    throw new Error(`Fixture must stay inside the served root: ${fixture}`);
  if (!(await stat(absoluteFixture)).isFile()) throw new Error(`Fixture is not a file: ${fixture}`);

  const server = await createStaticServer(absoluteRoot);
  const failures: string[] = [];
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Static server has no TCP port");
    const fixturePath = relative(absoluteRoot, absoluteFixture)
      .split(sep)
      .map(encodeURIComponent)
      .join("/");
    const url = `http://127.0.0.1:${address.port}/${fixturePath}`;
    const browser = await chromium.launch({ headless: true });
    try {
      for (const deviceScaleFactor of [1, 2]) {
        const context = await browser.newContext({
          deviceScaleFactor,
          locale: "en-US",
          viewport: { width: 1280, height: 900 },
        });
        try {
          const page = await context.newPage();
          const pageErrors: string[] = [];
          page.on("console", (message) => {
            if (message.type() === "error") pageErrors.push(`console: ${message.text()}`);
          });
          page.on("pageerror", (error) => pageErrors.push(`page: ${error.message}`));
          await page.goto(url, { waitUntil: "networkidle" });
          await page.waitForFunction(() => typeof globalThis.runRenderingContract === "function");
          const result = await page.evaluate(async (scale) => {
            await globalThis.document.fonts?.ready;
            if (!globalThis.runRenderingContract)
              throw new Error("Rendering contract is unavailable");
            return globalThis.runRenderingContract({ deviceScaleFactor: scale });
          }, deviceScaleFactor);
          const prefix = `Chromium DPR ${deviceScaleFactor}`;
          if (!result || !Array.isArray(result.checks) || result.checks.length === 0) {
            failures.push(`${prefix}: fixture returned no checks`);
            continue;
          }
          const failedChecks = result.checks.filter((check) => check?.pass !== true);
          for (const check of failedChecks) {
            failures.push(
              `${prefix} ${check?.name || "unnamed check"}: expected ${JSON.stringify(check?.expected)}, got ${JSON.stringify(check?.actual)}`,
            );
          }
          failures.push(...pageErrors.map((error) => `${prefix} ${error}`));
          console.log(
            `${result.name || fixture} ${prefix}: ${result.checks.length - failedChecks.length}/${result.checks.length} checks passed`,
          );
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await closeServer(server);
  }
  if (failures.length > 0)
    throw new Error(`Browser rendering contract failed:\n- ${failures.join("\n- ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
