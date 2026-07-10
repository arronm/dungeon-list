import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const distDir = resolve(root, "apps/extension/dist");
const outputPath = resolve(root, "extension-build.zip");

if (!existsSync(distDir)) {
  throw new Error("apps/extension/dist does not exist. Run npm run build -w @dungeon-list/extension first.");
}

if (existsSync(outputPath)) {
  rmSync(outputPath);
}

const result = spawnSync("zip", ["-r", outputPath, "."], {
  cwd: distDir,
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`zip exited with status ${result.status ?? "unknown"}.`);
}

console.log(`Wrote ${outputPath}`);

