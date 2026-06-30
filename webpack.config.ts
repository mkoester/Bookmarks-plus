import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import CopyPlugin from "copy-webpack-plugin";
import { merge } from "webpack-merge";
import type { Configuration } from "webpack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sharedManifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "manifests/manifest.shared.json"), "utf-8")
);

// package.json is the single source of truth for the version; it's injected into the manifest
// at build time so there's no second number to keep in sync.
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
);

// Deep merge: objects are merged recursively; arrays are unioned (deduplicated).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  mode: "development",
  devtool: "cheap-module-source-map",
  entry: {
    background: "./src/background/background.ts",
    newtab: "./src/newtab/newtab.ts",
    popup: "./src/popup/popup.ts",
    sidebar: "./src/sidebar/sidebar.ts",
    options: "./src/options/options.ts",
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

export default (env: { browser: "chrome" | "firefox" }): Configuration => {
  const browser = env?.browser ?? "chrome";
  const outDir = path.resolve(__dirname, `dist/${browser}`);

  return merge(shared, {
    output: {
      path: outDir,
      filename: "[name].js",
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: "src/newtab/newtab.html", to: "newtab/newtab.html" },
          { from: "src/newtab/newtab.css", to: "newtab/newtab.css" },
          { from: "src/popup/popup.html", to: "popup/popup.html" },
          { from: "src/popup/popup.css", to: "popup/popup.css" },
          { from: "src/sidebar/sidebar.html", to: "sidebar/sidebar.html" },
          { from: "src/sidebar/sidebar.css", to: "sidebar/sidebar.css" },
          { from: "src/options/options.html", to: "options/options.html" },
          { from: "src/options/options.css", to: "options/options.css" },
          { from: "public/icons", to: "icons" },
          {
            from: `manifests/manifest.${browser}.json`,
            to: "manifest.json",
            transform(content: Buffer) {
              const browserManifest = JSON.parse(content.toString());
              const merged = deepMergeManifests(sharedManifest, browserManifest);
              merged.version = pkg.version;
              return JSON.stringify(merged, null, 2);
            },
          },
        ],
      }),
    ],
  });
};
