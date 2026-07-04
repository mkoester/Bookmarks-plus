import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import CopyPlugin from "copy-webpack-plugin";
import { merge } from "webpack-merge";
import type { Configuration } from "webpack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadJson(relPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, relPath), "utf-8"));
}

// Build targets → the manifest files merged (in order) to produce that target's manifest.json.
// The new-tab override lives per-target (Firefox + the Chromium "new tab edition"); the standard
// Chromium build deliberately omits it so it leaves the native new tab alone.
const TARGET_MANIFESTS: Record<string, string[]> = {
  firefox: ["manifests/manifest.shared.json", "manifests/manifest.firefox.json"],
  chrome: ["manifests/manifest.shared.json", "manifests/manifest.chrome.json"],
  "chrome-newtab": [
    "manifests/manifest.shared.json",
    "manifests/manifest.chrome.json",
    "manifests/manifest.chrome-newtab.json",
  ],
};

// package.json is the single source of truth for the version; it's injected into the manifest
// at build time so there's no second number to keep in sync.
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
);

// Deep merge: objects are merged recursively; arrays are unioned (deduplicated).
function deepMergeManifests(base: any, override: any): any {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (Array.isArray(override[key]) && Array.isArray(base[key])) {
      result[key] = [...new Set([...base[key], ...override[key]])];
    } else if (
      typeof override[key] === "object" &&
      override[key] !== null &&
      !Array.isArray(override[key])
    ) {
      result[key] = deepMergeManifests(base[key] ?? {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

const shared: Configuration = {
  entry: {
    background: "./src/background/background.ts",
    newtab: "./src/newtab/newtab.ts",
    popup: "./src/popup/popup.ts",
    sidebar: "./src/sidebar/sidebar.ts",
    options: "./src/options/options.ts",
    onboarding: "./src/onboarding/onboarding.ts",
  },
  output: {
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
};

export default (env: { target?: string; browser?: string; mode?: string }): Configuration => {
  // `target` is preferred; `browser` is accepted for backwards compatibility.
  const target = env?.target ?? env?.browser ?? "chrome";
  // Release builds pass `--env mode=production` (tree-shaken, no source maps, but
  // NOT minified — see optimization below). Dev/watch builds default to development
  // with inline source maps.
  const isProd = env?.mode === "production";
  const manifestFiles = TARGET_MANIFESTS[target];
  if (!manifestFiles) {
    throw new Error(`Unknown build target "${target}". Known: ${Object.keys(TARGET_MANIFESTS).join(", ")}`);
  }

  const mergedManifest = manifestFiles.reduce<any>(
    (acc, file) => deepMergeManifests(acc, loadJson(file)),
    {}
  );
  mergedManifest.version = pkg.version;

  const outDir = path.resolve(__dirname, `dist/${target}`);

  return merge(shared, {
    mode: isProd ? "production" : "development",
    devtool: isProd ? false : "cheap-module-source-map",
    // Never minify: AMO advises against it (no perf benefit for locally-loaded
    // extension code, and minification triggers their source-code-submission
    // requirement). We keep production mode's tree-shaking + no source maps, but
    // ship readable JS. https://extensionworkshop.com/documentation/publish/source-code-submission/
    optimization: { minimize: false },
    // Webpack's default 244 KiB asset-size warning targets network-loaded web
    // pages; extension bundles load from local disk, so size is near-irrelevant.
    // background.js is ~250 KiB because fast-xml-parser ships as unminified
    // readable source (see above — no minify means no dead-code elimination).
    // Keep a tripwire at a higher threshold to still catch an accidentally
    // bundled fat dependency.
    performance: {
      maxAssetSize: 512 * 1024,
      maxEntrypointSize: 512 * 1024,
    },
    output: {
      path: outDir,
      filename: "[name].js",
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: "src/tokens.css", to: "tokens.css" },
          { from: "src/newtab/newtab.html", to: "newtab/newtab.html" },
          { from: "src/newtab/newtab.css", to: "newtab/newtab.css" },
          { from: "src/popup/popup.html", to: "popup/popup.html" },
          { from: "src/popup/popup.css", to: "popup/popup.css" },
          { from: "src/sidebar/sidebar.html", to: "sidebar/sidebar.html" },
          { from: "src/sidebar/sidebar.css", to: "sidebar/sidebar.css" },
          { from: "src/options/options.html", to: "options/options.html" },
          { from: "src/options/options.css", to: "options/options.css" },
          { from: "src/onboarding/onboarding.html", to: "onboarding/onboarding.html" },
          { from: "src/onboarding/onboarding.css", to: "onboarding/onboarding.css" },
          // Ship only the rendered PNGs the manifest references; icon.svg is the
          // source artwork, not needed in the package.
          { from: "public/icons", to: "icons", globOptions: { ignore: ["**/icon.svg"] } },
          {
            // Source is irrelevant — we emit the precomputed merged manifest; keep a real file as `from`.
            from: "manifests/manifest.shared.json",
            to: "manifest.json",
            transform() {
              return JSON.stringify(mergedManifest, null, 2);
            },
          },
        ],
      }),
    ],
  });
};
