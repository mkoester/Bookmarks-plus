import ext from "./browser";
import { isDevBuild } from "./buildInfo";

// The installed build's version as it should be displayed. Non-release builds carry
// the git-decorated version (…-<hash> / …-SNAPSHOT) in version_name on Chromium or in
// version itself on Firefox (see decoratedVersion() in webpack.config.ts), so prefer
// version_name. Undefined when the manifest has no version — e.g. the screenshot /
// verify-ui harness mocks — which keeps those headless runs badge-free.
export function installedVersion(): string | undefined {
  try {
    const m = ext.runtime.getManifest() as { version?: string; version_name?: string };
    return m.version_name ?? m.version;
  } catch {
    return undefined;
  }
}

// Marks a non-release build across any surface: sets data-build="dev" on <html>
// (tokens.css then reveals the .build-ribbon strip) and injects the ribbon showing the
// decorated version. No-op on release builds and when no version is available, so store
// builds and the headless harnesses stay clean. Idempotent. Mirrors the data-theme
// toggle in shared/theme.ts. Call once per page, right after applyStoredTheme().
export function applyBuildBadge(): void {
  const version = installedVersion();
  if (!isDevBuild(version)) return;
  document.documentElement.setAttribute("data-build", "dev");
  if (document.querySelector(".build-ribbon")) return;
  const ribbon = document.createElement("div");
  ribbon.className = "build-ribbon";
  ribbon.setAttribute("role", "status");
  ribbon.textContent = `DEV BUILD · ${version}`;
  // Insert inside the page's #app shell rather than as a <body> sibling: the
  // sidebar shell is a full-height flex column with a pinned footer, so a body-level
  // ribbon would overflow the viewport and push the footer below the fold. As the
  // first flex child, the scrollable #folders region yields the space instead.
  (document.getElementById("app") ?? document.body).prepend(ribbon);
}
