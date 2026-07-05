// Headless UI verification for the built extension pages.
//
// Why this exists: the pure `shared/` modules are covered by `pnpm test`
// (node:test), but the page bundles (popup/sidebar/options) need a real DOM and
// the mocked extension API to render. This runner drives them headlessly and
// asserts UI invariants that unit tests can't reach — folders render, the
// open-all / open-in-background buttons exist, and the pointer-based rule
// reordering actually reorders and shows its drop marker.
//
// How it works (same copy-and-inject trick as scripts/screenshots.mjs): the
// dist/chrome bundles are copied to a throwaway work dir; scripts/
// screenshot-harness.js is injected BEFORE each page's own <script> (so chrome.*
// is stubbed with deterministic demo data), and scripts/ui-verify/lib.js + the
// per-surface driver are injected AFTER it. Headless Chromium renders each page
// with --dump-dom; each driver writes a <pre id="verify-result"> of PASS/FAIL
// lines that this script parses. Exits non-zero on any failure.
//
// IMPORTANT — what this can and cannot verify: the drivers dispatch synthetic
// events. For logic and DOM shape that's authoritative; for the reordering it
// genuinely drives the real pointer handlers end-to-end (the reorder is
// pointer-based, not native drag-and-drop). It still cannot validate true
// native browser gestures — an earlier native-HTML5-DnD version passed a
// synthetic test while being broken in real Firefox. Treat a pass as a strong
// regression net, not a substitute for a real-browser smoke test of new gestures.
//
// Requires on PATH: chromium. No npm install needed.
// Run: pnpm verify:ui
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dist = path.join(root, "dist", "chrome");
const work = path.join(root, "web-store", ".verify-work");

// Each surface: the page dir/name and a window size (options needs width for the
// reorder geometry; the small surfaces just need to render).
const PAGES = [
  { page: "options", window: "1100,900" },
  { page: "popup", window: "420,700" },
  { page: "sidebar", window: "380,800" },
  { page: "newtab", window: "1100,900" },
];

function ensureBuilt() {
  if (!existsSync(path.join(dist, "manifest.json"))) {
    console.log("dist/chrome missing — building…");
    execFileSync("pnpm", ["run", "build:chrome"], { cwd: root, stdio: "inherit" });
  }
}

// Copy the build and inject harness (before the bundle) + verify lib & driver
// (after it) into each page's HTML.
function prepareWork() {
  rmSync(work, { recursive: true, force: true });
  cpSync(dist, work, { recursive: true });
  writeFileSync(path.join(work, "verify-harness.js"), readFileSync(path.join(root, "scripts/screenshot-harness.js")));
  writeFileSync(path.join(work, "verify-lib.js"), readFileSync(path.join(root, "scripts/ui-verify/lib.js")));

  for (const { page } of PAGES) {
    writeFileSync(path.join(work, `verify-${page}.js`), readFileSync(path.join(root, `scripts/ui-verify/${page}.js`)));
    const htmlPath = path.join(work, page, `${page}.html`);
    let html = readFileSync(htmlPath, "utf-8");
    html = html.replace(
      /<script src="\.\.\/([^"]+\.js)"><\/script>/,
      [
        '<script src="../verify-harness.js"></script>',
        '  <script src="../$1"></script>',
        '  <script src="../verify-lib.js"></script>',
        `  <script src="../verify-${page}.js"></script>`,
      ].join("\n")
    );
    writeFileSync(path.join(work, page, "_verify.html"), html);
  }
}

function decodeEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

// Render one page headlessly and return its parsed PASS/FAIL lines.
function verifyPage({ page, window: windowSize }) {
  const url = `file://${path.join(work, page, "_verify.html")}`;
  let dom;
  try {
    dom = execFileSync(
      "chromium",
      ["--headless=new", "--no-sandbox", "--disable-gpu", `--window-size=${windowSize}`, "--dump-dom", url],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (err) {
    return { page, lines: [`FAIL: chromium failed to render (${err.message})`], ok: false };
  }
  const match = dom.match(/<pre id="verify-result">([\s\S]*?)<\/pre>/);
  if (!match) {
    return { page, lines: ["FAIL: no verify-result produced (driver did not finish — see the --dump-dom timing notes in the memory)"], ok: false };
  }
  const lines = decodeEntities(match[1]).split("\n").filter(Boolean);
  return { page, lines, ok: lines.length > 0 && lines.every((l) => l.startsWith("PASS")) };
}

function main() {
  ensureBuilt();
  prepareWork();

  let allOk = true;
  for (const pageDef of PAGES) {
    const { page, lines, ok } = verifyPage(pageDef);
    allOk = allOk && ok;
    console.log(`\n${ok ? "✓" : "✗"} ${page}`);
    for (const line of lines) console.log(`   ${line.startsWith("PASS") ? "✓" : "✗"} ${line.slice(line.indexOf(":") + 2)}`);
  }

  rmSync(work, { recursive: true, force: true });
  if (!allOk) {
    console.log("\nUI verification FAILED");
    process.exit(1);
  }
  console.log("\nUI verification passed");
}

main();
