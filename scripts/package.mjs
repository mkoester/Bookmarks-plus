// Zips each built target in dist/<target>/ into web-store/ for store upload.
// Run after `pnpm build` (which produces production, source-map-free bundles).
// Requires the `zip` CLI on PATH.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));

// Git-based artifact versioning (same rules as thunderbird_send_as's build.sh):
// clean main → 1.0.2 · other branch → 1.0.2-<hash> · dirty tree → …-SNAPSHOT.
// Decorates the zip FILENAME only — the manifest inside must keep the plain
// version (Chrome Web Store allows only 1-4 dot-separated integers; AMO is
// similarly strict).
function decoratedVersion(base) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim();
  try {
    git("rev-parse", "--git-dir");
  } catch {
    console.warn("Not in a git repository — using base version only");
    return base;
  }
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const commit = git("rev-parse", "--short", "HEAD");
  let dirty = false;
  try {
    git("diff-index", "--quiet", "HEAD", "--");
  } catch {
    dirty = true;
  }
  let version = base;
  if (branch !== "main") version += `-${commit}`;
  if (dirty) version += "-SNAPSHOT";
  console.log(`Git info: branch=${branch}, commit=${commit}, status=${dirty ? "dirty" : "clean"}`);
  return version;
}

const version = decoratedVersion(pkg.version);

const TARGETS = ["firefox", "chrome", "chrome-newtab"];
const outDir = path.join(root, "web-store");
mkdirSync(outDir, { recursive: true });

for (const target of TARGETS) {
  const dist = path.join(root, "dist", target);
  if (!existsSync(dist)) {
    console.error(`Missing ${dist} — run \`pnpm build\` first.`);
    process.exit(1);
  }
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
