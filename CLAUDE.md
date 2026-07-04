# Project notes for Claude

## What this is

**Bookmarks+** — a browser extension that surfaces your bookmarks as a folder-based launcher. Two **surfaces** are always available (static manifest features, no runtime toggle): a toolbar-icon **popup** (`action.default_popup`) and a **sidebar / side panel** (Firefox `sidebar_action`, Chrome `side_panel`). A **New Tab** replacement is offered via `chrome_url_overrides.newtab`, but it's **static** — it can't be registered/unregistered at runtime (no API), and neither browser lets an override page redirect back to the native new tab (Firefox throws "Access denied" on about:home, Chromium shows about:blank#blocked). So there is no in-extension toggle; `newtab.ts` always renders the launcher when it runs. Whether it runs is the **browser's** call. Because only Firefox gives the user a clean revert (Settings → Home) while Chromium does not, the new-tab override is split per **build target** (see Build & tooling): Firefox has it; the standard Chromium build omits it (native new tab untouched); a third `chrome-newtab` target ships it as a separately-named **"Bookmarks+ (new tab edition)"**. On first install, `background.ts` opens `onboarding/onboarding.html` (a welcome page nudging the user to pin — no API exists to pin programmatically). None of the surfaces need a runtime permission. (Chrome `unlimitedStorage` is a required permission — Chromium rejects it as optional.) Supports multiple bookmark sources (providers). TypeScript, built from one codebase. Built iteratively with Claude starting 2026-06-22.

## Build & tooling

- **Package manager: pnpm** (not npm — `package-lock.json` is gitignored)
- `pnpm type-check` — `tsc --noEmit`, should be clean
- `pnpm test` — unit tests in `tests/*.test.ts` via `node --test` with the `tsx` loader (no framework). They cover the pure `shared/` modules (`url`, `validation`, `bookmarks`) and must stay free of DOM/`ext` imports (`shared/browser.ts` throws outside an extension context).
- `pnpm build` — runs **type-check + tests first**, then builds all three targets via webpack, **production mode** (tree-shaken, no source maps, **not minified** — `optimization.minimize: false`, because AMO advises against minification and it has no perf benefit for local extension code). `dev:*`/watch builds stay development with inline source maps. Mode is `--env mode=production` (see `isProd` in `webpack.config.ts`).
- `pnpm package` — builds, then zips each `dist/<target>/` into `web-store/bookmarks-plus-<target>-<version>.zip` for store upload (needs the `zip` CLI). `web-store/` is gitignored.
- `pnpm screenshots` — generates repeatable 1280×800 store screenshots to `web-store/screenshots/`. `scripts/screenshots.mjs` copies `dist/chrome`, injects `scripts/screenshot-harness.js` (mocks `chrome.*` with demo data so the real page bundles render headless), captures each surface with system **chromium --headless**, and frames the small ones with **ImageMagick** (caption font resolved via `fc-match`). Edit the `DEMO` data in the harness or the `SHOTS` list to change content. Needs `chromium` + `magick` on PATH; no npm install.
- **Icon source:** `public/icons/icon.svg` (white paperclip + "+" badge on linkding violet `#5856e0`); re-rasterise with `rsvg-convert -w 48/-w 128 icon.svg -o icon48/128.png`. `icon.svg` is excluded from the build copy (PNGs only ship).
- **Build targets** (webpack `--env target=…`, output `dist/<target>/`): `firefox` (shared + firefox manifests; has new-tab override), `chrome` (shared + chrome; NO new-tab override), `chrome-newtab` (shared + chrome + chrome-newtab overlay; new-tab override + renamed "Bookmarks+ (new tab edition)"). `TARGET_MANIFESTS` in `webpack.config.ts` lists the manifest files merged (in order) per target. Bundled JS is identical across targets — only the manifest differs.
- Load in Firefox: `about:debugging` → Load Temporary Add-on → `dist/firefox/manifest.json`
- Load in Chrome/Chromium: `chrome://extensions` → Enable developer mode → Load unpacked → `dist/chrome/` (or `dist/chrome-newtab/`)
- **Version bumping:** increment the patch version in `package.json` by 1 whenever building something the user should test in the browser (early development convention). `package.json` is the single source of truth — webpack injects it into every target's manifest at build time, so don't edit version in the manifests.

## Architecture decisions (already made, don't revisit)

**Surfaces & shortcuts** (non-obvious — don't "simplify" these away)
- New-tab gear (⚙, top-right of `newtab.html`) → `runtime.openOptionsPage()`. The link the *browser* shows at the bottom of an overridden new tab is browser attribution to about:addons; not ours, can't change it.
- **Chromium side-panel toggle**: `Ctrl+Shift+S` → `commands.open-side-panel` (declared only in `manifest.chrome.json`). Background **toggles** it: the side panel opens a `runtime.connect` port named `sidepanel:<windowId>` on load; background tracks open windows via those ports and, on the command, either `postMessage({type:"close"})` (panel calls `window.close()`) or `chrome.sidePanel.open()`. Why not `sidePanel.close()`: it **rejects for a global panel** (ours is global). `open()` is called directly in the handler to keep the user gesture.
- **Firefox sidebar**: `Ctrl+Alt+S` via the built-in `_execute_sidebar_action` command (native toggle); `registerForToggle()` in `sidebar.ts` no-ops on Firefox.
- **Onboarding** (`onboarding/`, opens on first install via `onInstalled` reason `"install"`): one shared page, **runtime-tailored** in `onboarding.ts`. Detect Firefox via `location.protocol === "moz-extension:"` (NOT `typeof browser` — truthy on Chromium too); detect new-tab build via `runtime.getManifest().chrome_url_overrides`. `chrome://` links are opened via `tabs.create` (plain `<a href="chrome://…">` navigation is blocked).

**Bookmark IDs**
- All `Bookmark.id` values are namespaced strings: `"${providerConfigId}:${rawId}"`
- `BookmarkMap = Record<string, Bookmark>`
- `Folder.bookmark_ids: string[]`
- This prevents ID collisions across providers

**Provider system**
- Each bookmark source is a `BookmarkProvider` (interface in `shared/types.ts`): `sync(): Promise<Bookmark[]>`
- Provider configs (stored in `Settings.providers`) are a discriminated union on `type`: `"static" | "json" | "browser" | "linkding"`
- Factory: `createProvider(config)` in `shared/providers/index.ts`
- Every sync is a full sync (no incremental) — TODO: add per-provider incremental support

**Four providers**
1. **Static** (`shared/providers/static.ts`) — returns `STATIC_BOOKMARKS` from `shared/data/static.ts`; for development
2. **JSON** (`shared/providers/json.ts`) — user pastes a JSON array; format: `{ id?, url, title, tag_names?, favicon_url? }[]`; validated by `shared/validation.ts`
3. **Browser** (`shared/providers/browser.ts`) — uses `ext.bookmarks.getTree()`; ancestor folder names become `tag_names`; requests `bookmarks` optional permission at first sync
4. **Linkding** (`shared/providers/linkding.ts`) — full paginated sync against the Linkding REST API

**Storage layout** (`chrome.storage.local` / `browser.storage.local`)
- Bookmarks stored as `BookmarkMap` — flat `Record<string, Bookmark>` keyed by namespaced ID
- Folders stored as `Folder[]` — each has user-defined rules and a precomputed `bookmark_ids: string[]`
- `bookmark_ids` recomputed in background worker after every sync, not at render time
- `lastSync` stored as ISO string (currently informational only — all providers do full sync)

**Favicon strategy** (`shared/favicon.ts` — `renderFavicon(bookmark, size)`)
- `favicon_url` is optional on `Bookmark` — only stored when a provider returns one; always preferred when present (Linkding supplies it server-resolved)
- **Chrome**: uses the browser's cached favicons via the `_favicon` endpoint (`ext.runtime.getURL("/_favicon/?pageUrl=…&size=…")`), gated on the `"favicon"` permission (Chrome manifest only). Handles `<link rel="icon">` declarations; no network request.
- **Firefox**: no favicon API exists, so it falls back to guessing `${origin}/favicon.ico`.
- **Last resort (both)**: an inline-SVG letter tile (site initial on a hue derived from the URL) when the icon fails to load. No more empty gaps.

**Sync flow**
- Background service worker owns all sync logic
- Two triggers: `chrome.alarms` (configurable interval, default 15 min) and `sync_requested` message from any UI page
- Debounced: won't sync more than once per minute
- Full sync always: iterates all configured providers, merges results into a single `BookmarkMap`

**Folder rules** (nested groups since 2026-07-04)
```typescript
type MatchMode = "all" | "any" | "none";
interface RuleGroup { match: MatchMode; conditions: RuleNode[]; }
type RuleNode = RuleCondition | RuleGroup;   // leaf has type+value, group has match+conditions
type FolderRules = RuleGroup;                // a folder's rules = the root group
type ConditionType = "tag" | "url_contains" | "title_contains";
```
Groups nest arbitrarily → `A AND (B OR C)` etc. Semantics (`matchesNode` in `shared/bookmarks.ts`), uniform at every level:

| match  | empty conditions | non-empty conditions            |
|--------|------------------|---------------------------------|
| `all`  | false            | every child matches (AND)       |
| `any`  | false            | at least one child matches (OR) |
| `none` | false            | no child matches (NOT(A OR B…)) |

Empty groups never match — deliberately **not** vacuous truth for `all`, so a half-built group can't silently match everything. **No migration needed**: the old flat `{match: "all"|"any", conditions: RuleCondition[]}` is structurally valid in the new format (json-rules-engine-style; JsonLogic was considered and rejected as too generic/verbose). Rules are validated by `parseRuleGroup`/`parseFolders` in `shared/validation.ts` (used by the options JSON editors, folder import, and defensively by `getFolders`). A bookmark can appear in multiple folders. No "uncategorized" folder.

**Browser API abstraction**
- `shared/browser.ts` exports a single `ext` object — `browser` in Firefox, `chrome` in Chrome
- All code imports from there; no direct `browser.*` or `chrome.*` calls

**URL scheme allowlist (security)**
- `shared/url.ts` — `isAllowedBookmarkUrl` (http/https/mailto/ftp) and `isAllowedFaviconUrl` (http/https/data). `new URL()` alone accepts `javascript:`, which would run in a privileged extension page, so schemes are enforced at validation time (JSON provider) AND defensively at render time (newtab/popup/sidebar neuter bad links; favicon.ts ignores unsafe `favicon_url`).

**Theme**
- `Settings.theme: "system" | "light" | "dark"` (default `system`). `shared/theme.ts` sets a `data-theme` attribute on `<html>`; `src/tokens.css` (copied to `dist/tokens.css`, linked by every page before its own CSS) maps it — plus the OS `prefers-color-scheme` when the attribute is absent — to a shared `:root` token set. Each page calls `applyStoredTheme()` in init; options has the picker (live preview via `setTheme`, persisted on Save).

**Sync error banner**
- Background `sync()` records per-provider failures to `storage.local` as `syncStatus: { at, errors }`. The new-tab/popup/sidebar surfaces render `shared/syncBanner.ts`'s banner from it (and re-render on `syncStatus` change). All text via `textContent` (provider names/messages are untrusted).

**Debug logging**
- `shared/debug.ts` — `DEBUG` (false in shipped builds) gates `debugLog`/`debugWarn`. Real failures still use `console.error`. Previously the browser provider dumped the whole bookmark tree to the console; that's now behind `DEBUG`.

**`unlimitedStorage` permission (Chrome only)**
- Chrome manifest: `optional_permissions: ["unlimitedStorage", "bookmarks"]`
- Firefox manifest: `optional_permissions: ["bookmarks"]` (no unlimitedStorage — not valid in Firefox)
- Storage warning threshold: 9 MB (in `shared/storage.ts`)

**Default / static dev data**
- `STATIC_BOOKMARKS` + `STATIC_FOLDERS` live in `shared/data/static.ts`
- `getFolders()` falls back to `STATIC_FOLDERS` when storage is empty
- Default settings use a single static provider so the extension works out of the box

## File map

```
shared/
  types.ts            — all TypeScript interfaces and the ProviderConfig union
  browser.ts          — Firefox/Chrome API shim
  storage.ts          — storage read/write helpers, storage warning logic
  bookmarks.ts        — bookmarksToMap, mergeIntoMap, matchesNode (recursive rule
                        evaluation), computeFolderMembership, safeFolderBookmarks
                        (pure logic, unit-tested)
  folderList.ts       — shared folder/bookmark DOM rendering for popup/sidebar/newtab
                        (renderFolderDetails/renderBookmarkItem; open behaviour injected via callbacks)
  validation.ts       — validateBookmarks() + entryToBookmark() for the JSON provider;
                        parseRuleGroup()/parseFolders() for folder rules (JSON editor,
                        import, defensive getFolders)
  providers/
    index.ts          — createProvider(config) factory
    static.ts         — StaticProvider
    json.ts           — JsonProvider
    browser.ts        — BrowserProvider (chrome.bookmarks, requests permission lazily)
    linkding.ts       — LinkdingProvider (paginated Linkding REST API)
  data/
    static.ts         — STATIC_BOOKMARKS (17 items) + STATIC_FOLDERS (Crowdsourcing, Fediverse,
                        plus two nested-rule showcases: "Community (not social media nor
                        crowdsourcing)" = community AND NOT (social-media OR crowdsourcing),
                        "Open knowledge" = knowledge AND (education OR opensource))

src/
  background/background.ts   — service worker: provider loop, alarms, message handler
  newtab/newtab.ts           — <section>/<h2> folder layout; bookmarks via shared
                               renderBookmarkItem (native anchors); storage change listener
  newtab/newtab.html/css
  popup/popup.ts             — shared renderFolderDetails; left-click/middle-click open
                               new tabs and close the popup
  popup/popup.html/css
  sidebar/sidebar.ts         — shared renderFolderDetails; left-click navigates current
                               tab, middle-click folder opens all in background tabs;
                               Chromium side-panel toggle port
  sidebar/sidebar.html/css
  options/options.ts         — provider management UI + recursive folder/rule editor,
                               per-folder JSON editor, folder export/import (replace-all,
                               staged in memory until Save), collapsed boolean-logic help
  options/options.html/css
  onboarding/onboarding.ts   — first-run welcome page, runtime-tailored per browser/target
  onboarding/onboarding.html/css

tests/                       — node:test unit tests for shared/ pure modules (run in pnpm build)

manifests/
  manifest.shared.json       — common to all targets (no version field; injected from package.json at build)
  manifest.chrome.json       — Chrome-only: background.service_worker + favicon/sidePanel/unlimitedStorage
  manifest.firefox.json      — Firefox-only: background.scripts + browser_specific_settings + chrome_url_overrides.newtab
  manifest.chrome-newtab.json — overlay for the chrome-newtab target: adds newtab override + renames to "(new tab edition)"
  (build deep-merges a target's manifest list in order; arrays are unioned — see TARGET_MANIFESTS in webpack.config.ts)

public/icons/
  icon.svg                   — icon source (paperclip + "+" on linkding violet); PNGs rasterised from it
  icon48.png / icon128.png   — shipped icons (see Build & tooling for the rsvg-convert command)

webpack.config.ts            — parameterised by --env target=firefox|chrome|chrome-newtab
                               @shared/* alias resolves to shared/
```

## Linkding API notes

Base URL: user-configured per provider. Auth: `Authorization: Token <token>` header.

Pagination: follows `next` links until exhausted (100 results per page).

## What's missing / next steps

**Functional gaps**
- [ ] Deletion handling — full sync replaces the whole map, so deletions from Linkding/browser are caught. But if a provider is removed, its bookmarks linger in storage until the next sync. TODO: filter map by active provider IDs after sync.
- [ ] Manual JSON import UI — `validateBookmarks()` exists in `validation.ts` and the options page has a JSON textarea, but there's no live validation feedback shown to the user
- [ ] Per-provider incremental sync — Linkding supports `modified_since`; could speed up large collections
- [x] ~~Options page host permission for Linkding URLs~~ — requested on Save, scoped to the configured origin (see README "Linkding connection & permissions")
- [x] ~~Real icons~~ — paperclip+"+" `icon.svg` created and rasterised (see Build & tooling)
- [x] ~~CSS placeholder~~ — shared `:root` token set in `src/tokens.css`, light/dark/system themes
- [x] ~~Error state UI when sync fails~~ — sync error banner (see Architecture)

**Nice to have**
- [ ] Folder ordering (drag to reorder)
- [ ] Bookmark ordering within folders
- [ ] Search/filter within the new tab page
- [ ] "Open in Linkding" context on individual bookmarks
- [ ] Error state UI when sync fails
- [ ] Show last sync timestamp in the new tab header

## Code style notes

- All variable names, comments, and output strings in English
- Prefer explicit types over inference where it aids readability
- No default exports except `shared/browser.ts`
- CSS colours go through the `src/tokens.css` `:root` tokens (`var(--bg)` etc.) — don't reintroduce hardcoded hex in page CSS, or light/dark theming breaks
