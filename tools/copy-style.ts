import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(root, "web"), { recursive: true });
await copyFile(resolve(root, "src", "index.css"), resolve(root, "web", "index.css"));
