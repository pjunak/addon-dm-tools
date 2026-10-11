// Keeps src/codex/ an exact copy of the host's public browser types at the
// host version this add-on builds against (go.mod, or the workflow's
// HOST_INSPECTOR pin when there is no go.mod).
//   node tools/codex-sdk.mts check   fail when the copy differs
//   node tools/codex-sdk.mts sync    rewrite the copy
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const host = "github.com/pjunak/ttrpg-codex";
const files = ["browser-sdk.d.ts", "contribution-edits.d.ts", "ui-controls.d.ts"];
const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
if (mode !== "check" && mode !== "sync") {
  console.error("usage: node tools/codex-sdk.mts check|sync");
  process.exit(2);
}

function hostVersion(): string {
  const goMod = resolve(root, "go.mod");
  const pin = existsSync(goMod)
    ? /^\s*(?:require\s+)?github\.com\/pjunak\/ttrpg-codex (\S+)/m.exec(readFileSync(goMod, "utf8"))
    : /HOST_INSPECTOR: \S+@(\S+)/.exec(
        readFileSync(resolve(root, ".github/workflows/test.yml"), "utf8"),
      );
  if (!pin?.[1]) throw new Error(`no ${host} version is pinned`);
  return pin[1];
}

const version = hostVersion();
const download = JSON.parse(
  execFileSync("go", ["mod", "download", "-json", `${host}@${version}`], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }),
) as { Dir?: string; Error?: string };
if (!download.Dir) throw new Error(download.Error ?? `could not download ${host}@${version}`);
const differing: string[] = [];
for (const file of files) {
  const expected = readFileSync(resolve(download.Dir, "contracts/addons/v3", file), "utf8");
  const target = resolve(root, "src/codex", file);
  const current = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  if (current === expected) continue;
  differing.push(file);
  if (mode === "sync") writeFileSync(target, expected);
}
if (mode === "sync") {
  console.log(`Copied ${differing.length} host browser type files from ${host}@${version}.`);
} else if (differing.length > 0) {
  console.error(
    `src/codex/ differs from ${host}@${version}: ${differing.join(", ")}\n` +
      "Run npm run sync:codex-sdk after changing the host version.",
  );
  process.exitCode = 1;
} else {
  console.log(`Host browser types match ${host}@${version}.`);
}
