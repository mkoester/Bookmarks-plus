/* Screenshot harness — a classic (non-module) script injected BEFORE each page
   bundle in the screenshot work copy. It stubs the extension API (`chrome.*`)
   with in-memory demo data so the real, unmodified page bundles render the full
   UI outside a browser-extension context. `browser` is intentionally left
   undefined so favicon.ts takes the Chrome `_favicon` path (the icons 404 → the
   deterministic letter-tile fallback, which keeps shots reproducible offline).

   The theme is taken from the `?theme=` query param so one harness produces light
   and dark variants. Edit DEMO below to change what the screenshots show. */
(() => {
  const theme = new URLSearchParams(location.search).get("theme") || "system";

  const settings = {
    syncIntervalMinutes: 15,
    theme,
    providers: [
      {
        id: "ld",
        type: "linkding",
        name: "linkding",
        url: "https://links.example.com",
        token: "demo-token",
        username: "me",
      },
    ],
  };

  // Demo bookmarks, keyed by namespaced id (provider "ld").
  const bookmarks = {};
  const add = (id, url, title, tags) => {
    bookmarks["ld:" + id] = { id: "ld:" + id, url, title, tag_names: tags };
  };
  add(1, "https://www.theverge.com/", "The Verge", ["read", "news"]);
  add(2, "https://arstechnica.com/", "Ars Technica", ["read", "news"]);
  add(3, "https://www.wikipedia.org/", "Wikipedia", ["read", "reference"]);
  add(4, "https://github.com/", "GitHub", ["dev", "code"]);
  add(5, "https://developer.mozilla.org/", "MDN Web Docs", ["dev", "reference"]);
  add(6, "https://news.ycombinator.com/", "Hacker News", ["dev", "news"]);
  add(7, "https://www.typescriptlang.org/", "TypeScript", ["dev", "code"]);
  add(8, "https://github.com/sissbruecker/linkding", "Linkding", ["selfhosted", "code"]);
  add(9, "https://www.home-assistant.io/", "Home Assistant", ["selfhosted"]);
  add(10, "https://pi-hole.net/", "Pi-hole", ["selfhosted"]);
  add(11, "https://joinmastodon.org/", "Mastodon", ["fediverse", "social"]);
  add(12, "https://pixelfed.org/", "Pixelfed", ["fediverse", "social"]);
  add(13, "https://lemmy.world/", "Lemmy", ["fediverse", "social"]);
  add(14, "https://www.figma.com/", "Figma", ["design", "tools"]);
  add(15, "https://coolors.co/", "Coolors", ["design", "tools"]);
  add(16, "https://fonts.google.com/", "Google Fonts", ["design", "tools"]);

  const folder = (id, name, value, ids) => ({
    id,
    name,
    rules: { match: "any", conditions: [{ type: "tag", value }] },
    bookmark_ids: ids.map((n) => "ld:" + n),
  });
  const folders = [
    folder("f1", "Reading list", "read", [1, 2, 3]),
    folder("f2", "Development", "dev", [4, 5, 6, 7]),
    folder("f3", "Self-hosted", "selfhosted", [8, 9, 10]),
    folder("f4", "Fediverse", "fediverse", [11, 12, 13]),
    folder("f5", "Design", "design", [14, 15, 16]),
  ];

  const now = new Date().toISOString();
  const STORE = {
    settings,
    folders,
    bookmarks,
    syncStatus: null,
    lastSync: now,
    providerSyncState: {
      ld: { lastSyncAt: now, lastAttemptAt: now, lastFullSyncAt: now, fingerprint: "demo" },
    },
  };

  const noop = () => {};
  const listener = { addListener: noop, removeListener: noop };

  globalThis.chrome = {
    storage: {
      local: {
        get(key) {
          if (typeof key === "string") return Promise.resolve({ [key]: STORE[key] });
          if (Array.isArray(key)) {
            const out = {};
            for (const k of key) out[k] = STORE[k];
            return Promise.resolve(out);
          }
          return Promise.resolve({ ...STORE });
        },
        set: () => Promise.resolve(),
      },
      onChanged: listener,
    },
    runtime: {
      sendMessage: () => Promise.resolve(),
      openOptionsPage: noop,
      getManifest: () => ({ chrome_url_overrides: { newtab: "newtab/newtab.html" } }),
      getURL: (p) => p,
      connect: () => ({ name: "", onMessage: listener, onDisconnect: listener, postMessage: noop }),
      onMessage: listener,
      onInstalled: listener,
      onConnect: listener,
    },
    tabs: {
      create: noop,
      update: noop,
      remove: noop,
      getCurrent: () => Promise.resolve({ id: 1 }),
    },
    windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
    permissions: {
      getAll: () => Promise.resolve({ origins: [], permissions: [] }),
      contains: () => Promise.resolve(true),
      request: () => Promise.resolve(true),
      remove: () => Promise.resolve(true),
    },
    alarms: { create: noop, clearAll: () => Promise.resolve(), onAlarm: listener },
    commands: { onCommand: listener },
  };
})();
