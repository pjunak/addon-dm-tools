// Keeps src/message-keys.ts, the TypeScript names of the English catalog's
// keys by section, in step with locales/en.json so translation calls are
// checked by the compiler.
//   node tools/message-keys.mts check   fail when the file is stale
//   node tools/message-keys.mts sync    rewrite it
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = `${root}src/message-keys.ts`;
const mode = process.argv[2];
if (mode !== "check" && mode !== "sync") {
  console.error("usage: node tools/message-keys.mts check|sync");
  process.exit(2);
}
const catalog = JSON.parse(readFileSync(`${root}locales/en.json`, "utf8")) as {
  readonly sections: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};
const members = Object.entries(catalog.sections).map(
  ([section, messages]) =>
    `  readonly ${JSON.stringify(section)}: ${Object.keys(messages)
      .map((key) => JSON.stringify(key))
      .join(" | ")};`,
);
const source = await prettier.format(
  [
    "// Generated from locales/en.json by tools/message-keys.mts; do not edit.",
    "export interface MessageKeys {",
    ...members,
    "}",
    "",
  ].join("\n"),
  { ...(await prettier.resolveConfig(target)), filepath: target },
);
const current = existsSync(target) ? readFileSync(target, "utf8") : undefined;
if (current === source) console.log("src/message-keys.ts matches locales/en.json.");
else if (mode === "sync") {
  writeFileSync(target, source);
  console.log("Rewrote src/message-keys.ts from locales/en.json.");
} else {
  console.error("src/message-keys.ts is stale. Run npm run sync:message-keys.");
  process.exitCode = 1;
}
