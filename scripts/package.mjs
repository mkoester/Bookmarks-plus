// Zips each built target in dist/<target>/ into web-store/ for store upload.
// Run after `pnpm build` (which produces production, source-map-free bundles).
// Requires the `zip` CLI on PATH.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// The git-decorated build version (clean main → 1.0.2 · other branch →
// 1.0.2-<hash> · dirty tree → …-SNAPSHOT) is computed at build time by
// webpack.config.ts and baked into each target's manifest: Chromium targets
// carry it in `version_name`, Firefox in `version` itself. Read it back from
// the built manifest so the zip filename always matches the zip's content.
function buildVersion(dist) {
  const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf-8"));
  return manifest.version_name ?? manifest.version;
}

const TARGETS = ["firefox", "chrome", "chrome-newtab"];
const outDir = path.join(root, "web-store");
mkdirSync(outDir, { recursive: true });

for (const target of TARGETS) {
  const dist = path.join(root, "dist", target);
  if (!existsSync(dist)) {
    console.error(`Missing ${dist} — run \`pnpm build\` first.`);
    process.exit(1);
  }
  const version = buildVersion(dist);
  const zipPath = path.join(outDir, `bookmarks-plus-${target}-${version}.zip`);
  rmSync(zipPath, { force: true });
  // `zip` must run from inside dist/<target> so paths in the archive are relative
  // to the extension root (manifest.json at top level, as the stores require).
  execFileSync("zip", ["-r", "-FS", "-q", zipPath, "."], { cwd: dist, stdio: "inherit" });
  console.log(`Packaged ${path.relative(root, zipPath)}`);
}

console.log("\nUpload artifacts in web-store/:");
console.log("  • Firefox (AMO):            bookmarks-plus-firefox-*.zip");
console.log("  • Chrome Web Store:         bookmarks-plus-chrome-*.zip");
console.log("  • Chrome Web Store (2nd):   bookmarks-plus-chrome-newtab-*.zip");
