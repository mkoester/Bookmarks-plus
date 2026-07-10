import ext from "@shared/browser";

// The onboarding page is one shared file copied into every build. Tailor the New Tab section to
// the build the user actually installed, detected from the manifest at runtime:
//   - Firefox            → has the override; Firefox offers a built-in revert.
//   - Chromium (new tab) → has the override; Chromium may have changed "On startup".
//   - Chromium (plain)   → no override; point at the "new tab edition" build.
// `typeof browser` is unreliable — Chromium also exposes a `browser` alias. Extension page URLs
// are the dependable signal: moz-extension:// on Firefox vs chrome-extension:// on Chromium.
const isFirefox = location.protocol === "moz-extension:";

// ---- DOM helpers (no innerHTML — AMO flags dynamic innerHTML assignment) -----

function strong(text: string): HTMLElement {
  const s = document.createElement("strong");
  s.textContent = text;
  return s;
}

function para(...parts: Array<Node | string>): HTMLParagraphElement {
  const p = document.createElement("p");
  p.append(...parts);
  return p;
}

function withClass<T extends HTMLElement>(el: T, className: string): T {
  el.className = className;
  return el;
}

function linkEl(id: string, href: string, ...parts: Array<Node | string>): HTMLAnchorElement {
  const a = document.createElement("a");
  a.id = id;
  a.href = href;
  a.append(...parts);
  return a;
}

// A plain <a href="chrome://…"> is blocked from navigating; open it via the tabs API instead.
function wireChromeLink(id: string, url: string): void {
  document.getElementById(id)?.addEventListener("click", (e) => {
    e.preventDefault();
    ext.tabs.create({ url });
  });
}

function tailorSidebarItem(): void {
  const item = document.getElementById("sidebar-item");
  if (!item) return;

  if (isFirefox) {
    // Ctrl+Alt+S is the suggested_key for _execute_sidebar_action in manifest.firefox.json.
    item.replaceChildren(
      strong("Sidebar"),
      " — open it from Firefox's sidebar, or press ",
      strong("Ctrl+Alt+S"),
      " (rebindable in about:addons → ⚙ → Manage Extension Shortcuts)."
    );
    return;
  }

  const shortcutsUrl = "chrome://extensions/shortcuts";
  item.replaceChildren(
    strong("Side panel"),
    " — press ",
    strong("Ctrl+Shift+S"),
    " to open it (rebindable at ",
    linkEl("shortcuts-link", shortcutsUrl, shortcutsUrl),
    "). Some Chromium builds also show a side-panel button in the toolbar, but others (e.g. " +
      "ungoogled-chromium) hide it — the shortcut always works."
  );
  wireChromeLink("shortcuts-link", shortcutsUrl);
}

function tailorNewTabSection(): void {
  const heading = document.getElementById("newtab-heading");
  const body = document.getElementById("newtab-body");
  if (!heading || !body) return;

  const manifest = ext.runtime.getManifest() as { chrome_url_overrides?: { newtab?: string } };
  const hasNewTab = Boolean(manifest.chrome_url_overrides?.newtab);

  if (hasNewTab && isFirefox) {
    heading.textContent = "New tabs & windows";
    body.replaceChildren(
      para(
        "New tabs now show your Bookmarks+ launcher — and so do new windows and the Home button, " +
          "since the launcher is also set as your homepage."
      ),
      para(
        "You always have the final say (even if another extension also sets these): open ",
        strong("about:preferences#home"),
        " and reset ",
        strong("Homepage and new windows"),
        " and ",
        strong("New tabs"),
        " — or use the notifications Firefox showed when the extension took over. You can flip " +
          "either back any time."
      )
    );
    return;
  }

  if (hasNewTab && !isFirefox) {
    const startupUrl = "chrome://settings/onStartup";
    heading.textContent = "New tab";
    body.replaceChildren(
      para("New tabs now show your Bookmarks+ launcher."),
      withClass(
        para(
          "Chromium may have changed your ",
          strong("On startup"),
          " setting when it took over the new tab. If your browser no longer restores your " +
            "previous session, open ",
          linkEl("startup-link", startupUrl, strong("Settings → On startup")),
          " and reselect ",
          strong("“Continue where you left off.”"),
          " New tabs will still show the launcher — the two settings are independent."
        ),
        "warn"
      ),
      withClass(
        para(
          "Didn't actually want the new-tab takeover? Install the standard ",
          strong("“Bookmarks+”"),
          " build instead — it leaves your native new tab alone."
        ),
        "muted"
      )
    );
    wireChromeLink("startup-link", startupUrl);
    return;
  }

  // Plain Chromium build: no override.
  heading.textContent = "New tab (not in this build)";
  body.replaceChildren(
    para("This build leaves your browser's native new tab untouched."),
    withClass(
      para(
        "Want new tabs to show your Bookmarks+ launcher instead? Install the ",
        strong("“Bookmarks+ (new tab edition)”"),
        " build."
      ),
      "muted"
    )
  );
}

document.addEventListener("DOMContentLoaded", () => {
  tailorSidebarItem();
  tailorNewTabSection();
});
