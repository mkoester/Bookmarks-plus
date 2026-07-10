# Project notes for Claude

## What this is

**Bookmarks+** — a browser extension that surfaces your bookmarks as a folder-based launcher. Two **surfaces** are always available (static manifest features, no runtime toggle): a toolbar-icon **popup** (`action.default_popup`) and a **sidebar / side panel** (Firefox `sidebar_action`, Chrome `side_panel`). A **New Tab** replacement is offered via `chrome_url_overrides.newtab`, but it's **static** — it can't be registered/unregistered at runtime (no API), and neither browser lets an override page redirect back to the native new tab (Firefox throws "Access denied" on about:home, Chromium shows about:blank#blocked). So there is no in-extension toggle; `newtab.ts` always renders the launcher when it runs. Whether it runs is the **browser's** call. Because only Firefox gives the user a clean revert (Settings → Home) while Chromium does not, the new-tab override is split per **build target** (see Build & tooling): Firefox has it; the standard Chromium build omits it (native new tab untouched); a third `chrome-newtab` target ships it as a separately-named **"Bookmarks+ (new tab edition)"**. **New windows** are covered too, but only Firefox needs anything extra: Chromium new windows open the New Tab page (so the newtab override already applies), while Firefox new windows and the Home button load the *homepage* (`about:home`) — a separate surface — so the Firefox manifest also sets `chrome_settings_overrides.homepage` to `newtab/newtab.html`. That points new windows + the Home button at the same launcher; Firefox prompts once to allow it and lets the user revert under Settings → Home → Homepage and new windows. The `homepage` key is Firefox-only (Chromium's is Windows-only Home-button behaviour, not the new-window NTP), so it lives in `manifest.firefox.json` alongside the newtab override — no new build target (Firefox's clean revert is why the newtab split stayed Chromium-only, and the same reasoning applies here). On first install, `background.ts` opens `onboarding/onboarding.html` (a welcome page nudging the user to pin — no API exists to pin programmatically). None of the surfaces need a runtime permission. (Chrome `unlimitedStorage` is a required permission — Chromium rejects it as optional.) Supports multiple bookmark sources (providers). TypeScript, built from one codebase. Built iteratively with Claude starting 2026-06-22.

## Build & tooling

- **Package manager: pnpm** (not npm — `package-lock.json` is gitignored)
- `pnpm type-check` — `tsc --noEmit`, should be clean
- `pnpm test` — unit tests in `tests/*.test.ts` via `node --test` with the `tsx` loader (no framework). They cover the pure `shared/` modules (`url`, `validation`, `bookmarks`, `reorder`) and must stay free of DOM/`ext` imports (`shared/browser.ts` throws outside an extension context).
- `pnpm verify:ui` — headless UI regression check the unit tests can't reach (they need a real DOM + the built bundle). `scripts/verify-ui.mjs` copies `dist/chrome`, injects `screenshot-harness.js` (mock `chrome.*`) + `scripts/ui-verify/lib.js` + a per-surface driver (`scripts/ui-verify/{options,popup,sidebar,newtab}.js`), runs each page under **chromium --dump-dom**, and greps a `<pre id="verify-result">` of PASS/FAIL lines; exits non-zero on failure. Asserts: folders render, the open-all / open-in-background buttons exist, the pointer-based rule AND folder reorders actually reorder + show their `.drop-marker`, the new-tab open-all honours `newTabCloseOnOpenAll` (the newtab driver spies on the harness's `chrome.tabs.create/remove` and flips the live settings object), and the provider tab shows the sync-interval override + full-sync-interval inputs, the last-synced time, and a working "Sync now" button (spied `sendMessage` → `sync_provider` with the right id, disables while syncing). Folder-source checks: the surfaces' hidden `#sync-folders` button becomes visible when the drivers patch a `folderSource` into the harness settings (they wrap `chrome.storage.local.get` before DOMContentLoaded, mutating in place — the newtab driver depends on the harness's live settings object), the popup click sends `sync_provider`/`folder-source`, and the options Folders tab flips to read-only (editor gone, import hidden, export kept) when a source URL is entered + blurred, back to editable when the pause toggle (`.folder-source-enabled`) is unchecked (URL kept), read-only again when re-checked, and editable again when the URL is cleared. Needs `chromium` on PATH; no npm install. Chromium **cannot launch inside the sandbox** (singleton Unix socket blocked; the runner prints the FATAL line — see the OKF sandbox gotchas), so the exact command `pnpm verify:ui` is in the workspace's sandbox `excludedCommands` (runs unsandboxed; since 2026-07-07) — run it bare, never as part of a `&&`/pipe chain or the exclusion won't match. **Caveat:** synthetic events validate handler logic + DOM (and drive the pointer-drag handlers genuinely end-to-end), but can't validate true *native* browser gestures — see the drag-reorder note under "Folder rules". Add a driver check whenever you add UI a unit test can't cover.
- `pnpm build` — runs **type-check + tests first**, then builds all three targets via webpack, **production mode** (tree-shaken, no source maps, **not minified** — `optimization.minimize: false`, because AMO advises against minification and it has no perf benefit for local extension code). `dev:*`/watch builds stay development with inline source maps. Mode is `--env mode=production` (see `isProd` in `webpack.config.ts`).
- `pnpm package` — builds, then zips each `dist/<target>/` into `web-store/bookmarks-plus-<target>-<version>.zip` for store upload (needs the `zip` CLI). `web-store/` is gitignored. The `<version>` in the filename is read back from the built manifest (`version_name ?? version`), so it always matches the zip's content.
- `pnpm screenshots` — generates repeatable 1280×800 store screenshots to `web-store/screenshots/`. `scripts/screenshots.mjs` copies `dist/chrome`, injects `scripts/screenshot-harness.js` (mocks `chrome.*` with demo data so the real page bundles render headless), captures each surface with system **chromium --headless**, and frames the small ones with **ImageMagick** (caption font resolved via `fc-match`). Edit the `DEMO` data in the harness or the `SHOTS` list to change content. Needs `chromium` + `magick` on PATH; no npm install.
- **Icon source:** `public/icons/icon.svg` (white paperclip + "+" badge on linkding violet `#5856e0`); re-rasterise with `rsvg-convert -w 48/-w 128 icon.svg -o icon48/128.png`. `icon.svg` is excluded from the build copy (PNGs only ship).
- **Build targets** (webpack `--env target=…`, output `dist/<target>/`): `firefox` (shared + firefox manifests; has new-tab override), `chrome` (shared + chrome; NO new-tab override), `chrome-newtab` (shared + chrome + chrome-newtab overlay; new-tab override + renamed "Bookmarks+ (new tab edition)"). `TARGET_MANIFESTS` in `webpack.config.ts` lists the manifest files merged (in order) per target. Bundled JS is identical across targets — only the manifest differs.
- Load in Firefox: `about:debugging` → Load Temporary Add-on → `dist/firefox/manifest.json`
- Load in Chrome/Chromium: `chrome://extensions` → Enable developer mode → Load unpacked → `dist/chrome/` (or `dist/chrome-newtab/`)
- **Version bumping:** bump the patch version in `package.json` **once, right after a release, on the `develop` branch only** — `develop` then carries the next release's version; `main`'s version changes only when a release is merged into it. Do NOT bump per test build (that was an early-development convention, retired 2026-07-04): intermediate builds are already recognisable in the browser via the git-decorated version (next bullet). `package.json` is the single source of truth — webpack injects it into every target's manifest at build time, so don't edit version in the manifests.
- **Git-decorated build versions** (same rules as thunderbird_send_as's `build.sh`): clean main → `1.1.3` · other branch → `1.1.3-<hash>` · dirty tree → `…-SNAPSHOT`. Computed by `decoratedVersion()` in `webpack.config.ts` at build time and written into the manifest: manifest `version` always stays the store-safe plain number, and when decorated ≠ plain the decoration goes into `version_name` on Chromium targets (display-only string) or into `version` itself on Firefox (no `version_name` support, Bugzilla #1380219; FF ≥ 108 installs it with a warning). The options-page header shows `version_name ?? version`. Store uploads are clean-main builds, so nothing non-standard can reach AMO/CWS.
- **Dev-build ribbon** (env.style-inspired, 2026-07-10): a coloured strip shown on every surface (options/popup/sidebar/newtab) for non-release builds, so you can tell a dev build from a release at a glance. `shared/buildInfo.ts`'s pure `buildKind(version)` classifies the manifest's `version_name ?? version` — `release` (no hyphen → clean main) / `branch` (`…-<hash>` → clean off-main) / `dirty` (`…-SNAPSHOT`). `shared/buildBadge.ts`'s `applyBuildBadge()` (called after `applyStoredTheme()` in each surface's init) sets `data-build` on `<html>` and injects a `.build-ribbon`; `src/tokens.css` tints it **yellow for branch, amber for dirty** (release shows nothing, so store builds stay clean automatically — no build change needed). Inserted into `#app`, not `<body>`, so the sidebar's full-height flex column keeps its footer pinned. Mirrors the `data-theme` mechanism; `buildInfo.ts` is split ext-free so its unit test runs in node.

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

**Bookmark dates & "latest N" limits (since 1.1.3)**
- `Bookmark.date?: string` (ISO) — when the provider knows it: linkding `date_added`, browser `dateAdded`, RSS `pubDate`/RDF `dc:date`/Atom `published|updated`, JSON Feed `date_published|date_modified`, JSON-paste optional `date`. Normalised via `toIsoDate()` (validation.ts); unparseable → absent, never garbage.
- `Bookmark.dateModified?: string` (ISO) — linkding's `date_modified` only (`shared/providers/linkding.ts`); every other provider leaves it undefined. Basis for the folder `sort: "modified"` mode (falls back to `date` when absent).
- `Folder.limit?: number` — show only the newest N matches. Applied in `computeFolderMembership` via `latestN()` (bookmarks.ts): sort by date desc, undated last in input order (= feed order, conventionally newest-first). Editor: the small "Latest N" number input in the folder header; validated by `parseFolders` (positive integer). This is a *selection* step (which N to include) — separate from and applied before the display-ordering step below.
- `FeedProviderConfig.maxItems?: number` — per-feed cap applied at sync time (also `latestN`), for feeds that ship 150+ items. Empty = keep all.

**Folder display ordering — weight + sort (since 2026-07-05)**
- `RuleCondition.weight?: number` — only meaningful on a condition that is a direct child of an `"any"` (OR) group **with 2+ conditions** (ranking between OR alternatives); the options editor only shows the weight `<input>` there (`renderGroupEditor` passes `renderConditionEditor` a `showWeight = group.match === "any" && group.conditions.length >= 2` boolean — a lone OR condition has nothing to rank against, so no field). `matchWeight(bookmark, node)` (bookmarks.ts) scores a bookmark against a rule (sub)tree: leaf = `matched ? (weight ?? 0) : 0`; `"any"` group = MAX over matched children; `"all"` group = SUM over children; `"none"` group = always 0. Unweighted conditions default to `0`, so a folder with no weights configured scores everyone `0` — no separate "has any weight" flag needed, it just falls through.
- `Folder.sort?: "added" | "modified" | "alphabetical"` — secondary tiebreak, only consulted when two bookmarks tie on weight (which is always, for folders with no weights configured). Absent = original/stable order.
- `sortForDisplay(bookmarks, folder)` (bookmarks.ts) applies weight-desc-then-sort-mode; wired into `computeFolderMembership` **after** the `limit`-based selection step, so `bookmark_ids` pipeline is: rule filter → `latestN` selection (if `limit` set) → `sortForDisplay` (display order). Runs once per sync in the background worker; popup/sidebar/newtab all just read the already-ordered `bookmark_ids`.
- `parseRuleNode`/`parseFolders` (validation.ts) accept both fields as optional; old stored data and JSON import/export round-trip unchanged with no migration.
- **UI**: the folder-header row only holds the name input + "Edit as JSON"/"Remove" buttons — `Latest`/`Sort` moved to their own `.folder-settings` row underneath (originally crammed into the header alongside everything else, which overflowed the header and squeezed the name field once `Sort` was added; two rows is the fix, not a wrapping hack). The weight input is wrapped in a visible `<label>Weight<input>…` (same pattern as `Latest`/`Sort`), not a bare `placeholder` — a placeholder disappears the moment a value is typed, leaving the number meaningless. A collapsible `renderSortHelp()` (styled like the existing boolean-logic help, once per Folders panel, not per folder) explains in prose that Weight always wins first and Sort only breaks ties — this needs spelling out in the UI itself, a tooltip alone isn't discoverable enough.

**Provider system**
- Each bookmark source is a `BookmarkProvider` (interface in `shared/types.ts`): `sync(): Promise<Bookmark[]>`
- Provider configs (stored in `Settings.providers`) are a discriminated union on `type`: `"static" | "json" | "browser" | "linkding" | "jsonfeed"`
- Factory: `createProvider(config)` in `shared/providers/index.ts`
- `BookmarkProvider.sync(ctx?: SyncContext): Promise<SyncResult>` (since 2026-07-05): the context carries what the loop remembers from the last successful sync (linkding cursor, feed HTTP validators, and a `full` flag that forbids using them); the result declares its `kind` — `full` (complete corpus, replaces the provider's map slice), `incremental` (new/changed only, upserted), `unchanged` (feed 304, slice kept). static/json/browser always return `full`.

**Five providers**
1. **Static** (`shared/providers/static.ts`) — returns `STATIC_BOOKMARKS` from `shared/data/static.ts`; for development
2. **JSON** (`shared/providers/json.ts`) — user pastes a JSON array; format: `{ id?, url, title, tag_names?, favicon_url? }[]`; validated by `shared/validation.ts`
3. **Browser** (`shared/providers/browser.ts`) — uses `ext.bookmarks.getTree()`; ancestor folder names become `tag_names`; requests `bookmarks` optional permission at first sync
4. **Linkding** (`shared/providers/linkding.ts`) — full paginated sync against the Linkding REST API
5. **Web feed** (`shared/providers/feed.ts`, `FeedProvider`) — fetches a feed URL and **auto-detects the format** by sniffing the body (`{` → JSON Feed, `<` → XML: RSS 2.0/0.9x, RSS 1.0 RDF, Atom 1.0). The feed's *current items* become bookmarks (full sync mirrors the feed, so items age out naturally). Config type is `"feed"`; **`"jsonfeed"` is a legacy alias** (pre-RSS, v1.1.2, never store-released) accepted everywhere via `isFeedProvider()` — don't remove it.
   - **JSON Feed** mapping: `parseJsonFeed` (`shared/validation.ts`, pure/unit-tested); versions 1 + 1.1; `preferExternalUrl` (config, default true) picks `external_url` over `url` for linkblogs (JSON-Feed-only concept, no-op for XML); feed-level `favicon` applies to all items.
   - **RSS/Atom** mapping: `parseXmlFeed` (`shared/rss.ts`, pure/unit-tested) using **fast-xml-parser** — the repo's first and only runtime dependency, chosen deliberately: **the Chrome MV3 service worker has no DOMParser** (Firefox's event page does), and an offscreen-document split would fork the code path per browser *and* make the mapping untestable in node. `removeNSPrefix` folds `rdf:`/`dc:` so RDF shares the RSS item mapping; RSS `<guid isPermaLink="false">` is an id but never a URL; Atom picks the `rel="alternate"` (or rel-less) link; categories/`dc:subject`/`term` → tags.
   - Shared for both: title fallback `deriveTitle` in validation.ts (explicit → text content → regex-stripped HTML → URL, 80-char cap, entity decoding); items without a safe URL (`isAllowedBookmarkUrl`) are skipped (debug-logged); parse failure → throw → sync error banner. **Encoding**: `decodeFeedBytes` (`shared/rss.ts`) re-decodes via the XML-prolog `encoding=` when no HTTP charset header is present (`response.text()` never reads the prolog; old German feeds still ship iso-8859-1). Host permission for the feed origin is requested on Save via the same mechanism as Linkding (`remoteProviderUrl`/`remoteProviderOrigins` in options.ts).

**Storage layout** (`chrome.storage.local` / `browser.storage.local`)
- Bookmarks stored as `BookmarkMap` — flat `Record<string, Bookmark>` keyed by namespaced ID
- Folders stored as `Folder[]` — each has user-defined rules and a precomputed `bookmark_ids: string[]`
- `bookmark_ids` recomputed in background worker after every sync that changed anything, not at render time
- `lastSync` stored as ISO string (informational); per-provider bookkeeping in `providerSyncState` (see Sync flow); folder-source bookkeeping in `folderSourceState` (see Remote folder source)

**Favicon strategy** (`shared/favicon.ts` — `renderFavicon(bookmark, size)`)
- `favicon_url` is optional on `Bookmark` — only stored when a provider returns one; always preferred when present (Linkding supplies it server-resolved)
- **Chrome**: uses the browser's cached favicons via the `_favicon` endpoint (`ext.runtime.getURL("/_favicon/?pageUrl=…&size=…")`), gated on the `"favicon"` permission (Chrome manifest only). Handles `<link rel="icon">` declarations; no network request.
- **Firefox**: no favicon API exists, so it falls back to guessing `${origin}/favicon.ico`.
- **Last resort (both)**: an inline-SVG letter tile (site initial on a hue derived from the URL) when the icon fails to load. No more empty gaps.

**Sync flow (per-provider scheduling + incremental, since 2026-07-05)**
- Background service worker owns all sync logic; the pure scheduling/merge helpers live in `shared/sync.ts` (unit-tested, DOM/ext-free)
- Triggers: `chrome.alarms`, `sync_requested` (any UI page; forced sync of all providers), `sync_provider` ("Sync now" for one provider, see below). The alarm period is `alarmPeriodMinutes()` = min(global interval, all per-provider overrides); each tick only syncs providers that are **due** (`isDue`, based on `lastAttemptAt` so a failing provider retries at its own interval, not every tick). The alarm is re-created on every settings change via a `storage.onChanged` listener — previously it was only set in `onInstalled`, so interval edits silently never applied (old bug, fixed in this rework)
- **Per-provider interval override**: `syncIntervalMinutes?` on linkding/feed/browser configs (sources that change independently of the extension; static/json only change via Save, which force-syncs anyway). UI: "Sync interval override" input on the provider's own tab; `effectiveIntervalMinutes()` falls back to the global setting
- **Incremental syncs**: linkding sends `modified_since=<cursor>` where the cursor is the highest `date_modified` ever seen (server-side clock — client skew can't lose updates; `maxModifiedCursor`). Feeds send `If-None-Match`/`If-Modified-Since` (with `cache: "no-store"` so OUR validators reach the server, not the HTTP cache's) and treat a 304 as `kind: "unchanged"` — feeds have no standard delta protocol, a 200 body is always the full current list, so the win is skipping download+parse. **Verified live**: xkcd.com honours the ETag round-trip; the linkding query/pagination path was exercised against a local mock of the API (no credentials on this workstation)
- **Deletions are invisible to `modified_since`** (linkding has no tombstone API; archiving just removes the bookmark from the list), so `needsFullSync()` forces a full sync per provider at least every `fullSyncMaxAgeMs(config)` — the per-provider `fullSyncIntervalHours` (linkding/feed config + options input, default `DEFAULT_FULL_SYNC_HOURS` = 24) — that's the staleness ceiling for deletes/archives — and whenever the config `providerFingerprint()` changed (URL/token/feed options edited; the json provider hashes its pasted data with FNV-1a instead of embedding it; the two scheduling fields are deliberately NOT in the fingerprint). The check is wall-clock (`lastFullSyncAt` vs now), so time asleep/powered off counts: the first sync after wake goes full if the ceiling passed meanwhile (covered by a unit test)
- **"Sync now" button** (options: Overview provider rows + each provider tab's actions row next to Remove) on linkding/feed/browser only — same "source changes on its own" rationale as the interval override. Sends `{type:"sync_provider", providerId}`; the background runs `sync(true, providerId)` (forced = bypasses schedule + debounce, but NOT the incremental logic) and `sendResponse`s only when done (listener returns `true` to keep the channel open), so options can reload `providerSyncState`/bookmarks and re-render fresh. Caveat shown as tooltip: it syncs the last SAVED settings, not unsaved edits in the form
- **"Full sync now" button** (linkding only: provider tab next to Sync now + Overview row, since 2026-07-07): same message with `full: true` → `sync(true, providerId, forceFull=true)`, which ORs into the `needsFullSync` decision — bypasses the `modified_since` cursor so deletions/archiving are picked up immediately instead of waiting for the periodic full sync (whose clock it also resets via `lastFullSyncAt`). Deliberately not offered for feeds (a feed 200 is always the complete list; full would only skip the conditional GET). `renderFullSyncNowButton` mirrors `renderSyncNowButton`
- Bookkeeping lives in `storage.local.providerSyncState` (`ProviderSyncStateMap`, keyed by provider config id): `lastSyncAt`/`lastAttemptAt`/`lastFullSyncAt`, `fingerprint`, linkding `cursor`, feed `etag`/`lastModified`. The options provider tab shows `lastSyncAt` as "Last synced: …"
- Merging is slice-based (`applySyncResult`): a provider only ever touches ids prefixed `${its config id}:`. After every round `pruneBookmarks` drops slices (and state entries) of removed providers — closes the old "removed provider's bookmarks linger" gap
- `sync_requested` (`force`) bypasses the schedule but NOT the incremental logic, and always recomputes+saves folders (an options Save can change folder rules while every provider reports "unchanged"). A scheduled tick where nothing was due and nothing changed writes nothing at all
- Sync statuses are partial now (only due providers run), so `syncStatus.errors` are **merged** (`mergeSyncErrors`, keyed by the new `SyncError.providerId`): an error sticks in the banner until its provider is retried or removed
- Debounced: won't sync more than once per minute (`force` bypasses)

**Remote folder source (since 2026-07-07)**
- `Settings.folderSource?: { url, syncIntervalMinutes?, enabled? }` — optional JSON file on a web server (same format as the folder export, validated by `parseFolders`) that OWNS the folder definitions: every successful fetch **replaces all folders** (then membership is recomputed). While **active**, the options Folders tab renders the folders **read-only** (`renderFolderReadOnly`, import hidden, Export kept — it seeds the remote file) and `save()` **skips `saveFolders`** (the file owns them; writing the options page's stale copy could outlive the next "unchanged" fetch).
- **Pause toggle + re-enable guard (since 2026-07-10)**: `enabled?: boolean` on the config — **absent = enabled** (back-compat; configs from before the toggle keep syncing). `enabled === false` = **paused**: the URL and its host permission are kept, but the source doesn't fetch and no longer owns the folders, so the options Folders tab is **editable again** and `save()` **persists** local folder edits. Purpose: iterate on folders locally → Export/upload → re-enable. Single predicate `isFolderSourceActive(config)` (`shared/folderSource.ts`, = url set && `enabled !== false`) gates everything: `folderSourceDue` (returns false when paused, even forced), background `errorScopeIds` (a paused source drops its sticky banner error), the surfaces' ⟳ button (`syncFoldersButton.ts`), and `alarmPeriodMinutes` (inlined in `sync.ts` to avoid a cycle — a paused interval must not shorten the alarm). Options mirrors it with `folderSourceActive()` (`folderSourceConfigured()` = url set, still used for the toggle + Sync-now-button eligibility, which also requires the SAVED source be active). **Re-enable guard**: resuming hands ownership back to the file, whose next fetch replaces all folders — so **checking the toggle back on** (`confirmReEnableFolderSource`) fires a `window.confirm` IF the folders diverged from `foldersBaseline` (an in-memory snapshot of the remote-owned folders, captured on load-while-active and on toggle-to-paused; `null` when it can't prove safety → confirm). On cancel the checkbox reverts to unchecked (stays paused). The guard lives on the toggle, NOT in `save()` — the user wanted to be asked at the moment they re-enable, not later at Save. Baseline is re-set after a successful save and after a manual "Sync folders now".
- Logic lives in `shared/folderSource.ts` (ext/DOM-free, unit-tested): `fetchFolderSource` (conditional GET via `ETag`/`If-Modified-Since` + **FNV-1a content hash** so an unchanged body is `kind:"unchanged"` even without server validators — matters because `parseFolders` regenerates folder ids when the file has none, which would otherwise churn storage/render on every fetch), `folderSourceDue`, `nextFolderSourceState`. State in its own storage key `folderSourceState` (NOT in `providerSyncState` — the provider pruning loop would delete a reserved key).
- **Scheduling is deliberately NOT "on every force"**: surfaces send `sync_requested` (force) on every open, so `folderSourceDue` only fires on (a) the explicit buttons, (b) never-fetched/URL-changed (covers "right after Save"), (c) the opt-in per-source interval (which also joins `alarmPeriodMinutes`). Default = manual refresh only.
- **"Sync folders now" buttons**: reuse the `sync_provider` message with the reserved id `FOLDER_SOURCE_ID = "folder-source"` (can't collide — provider ids are UUIDs); background maps it to a folder-source-only forced sync (the provider loop naturally skips everything). Options: button on the Folders tab (only once a source was SAVED). Surfaces: a ⟳ button `#sync-folders` (class `sync-folders-btn`, tooltip "Sync folders now") next to Settings in popup/sidebar footers and the newtab header, hidden unless configured (`shared/syncFoldersButton.ts`; popup re-renders via callback — it has no storage listener; sidebar/newtab re-render via their listeners and refresh visibility on settings changes). Spin animation in tokens.css.
- Errors surface in the existing sync banner: `SyncError.providerId = FOLDER_SOURCE_ID`, merged via `mergeSyncErrors` with the sentinel appended to attempted/active ids. Failure keeps the last good folders. The banner wording distinguishes folder-source from provider failures (`syncBanner.ts` checks the sentinel: "The folder source couldn't be synced" / "Showing the folders from the last successful sync"); fetch error messages carry no "Folder source" prefix (the banner/options already label them). The options Folders tab additionally shows the sticky folder-source error inline ("Last sync failed — …", from `syncStatus`, refreshed by "Sync folders now"). NOTE the sticky-error semantics: a *provider* error in the banner (e.g. "linkding: Couldn't connect") stays until THAT provider is retried — "Sync folders now" doesn't retry providers, so it can't clear a linkding error.
- Host permission: the source origin joins the Save-time bundled `permissions.request` (same as linkding/feeds); a no-longer-needed old source origin is revoked on Save, and `revokeProviderPermissions` counts the saved folder source as still-needing a shared origin. UI hints to use RAW URLs (`raw.githubusercontent.com`, not the github.com page).
- Portability caveat (documented in UI + README): `provider` conditions hold per-install provider config ids — a shared folder file should use tag/URL/title conditions.
- Options UX: the URL input re-renders (flipping read-only) on `change`, not `input` — a per-keystroke `renderTabs()` would steal focus.

**Folder rules** (nested groups since 2026-07-04)
```typescript
type MatchMode = "all" | "any" | "none";
interface RuleGroup { match: MatchMode; conditions: RuleNode[]; }
type RuleNode = RuleCondition | RuleGroup;   // leaf has type+value, group has match+conditions
type FolderRules = RuleGroup;                // a folder's rules = the root group
type ConditionType = "tag" | "url_contains" | "title_contains" | "provider" | "browser_base";
```
Groups nest arbitrarily → `A AND (B OR C)` etc. The `provider` condition's value is a **provider config id**; it matches via the namespace prefix of the bookmark id (`startsWith("${value}:")`), so no field was added to `Bookmark`. The options editor renders its value as a dropdown of configured providers (a value pointing at a removed provider is kept as an "Unknown provider" entry, never silently rewritten). The `browser_base` condition (value `firefox`|`chromium`, since 2026-07-10) is **bookmark-independent** — it compares the build's `browserBase` constant (see Compile-time browser base) to its value, so it's the same true/false for every bookmark in a given build; used to gate a folder to one browser (e.g. the static "Browser tools" folder). Its value is rendered as a fixed firefox/chromium dropdown; like `provider`, an unknown value is validated leniently (just never matches). Membership is computed at sync time, where the constant equals the built target. Semantics (`matchesNode` in `shared/bookmarks.ts`), uniform at every level:

| match  | empty conditions | non-empty conditions            |
|--------|------------------|---------------------------------|
| `all`  | false            | every child matches (AND)       |
| `any`  | false            | at least one child matches (OR) |
| `none` | false            | no child matches (NOT(A OR B…)) |

Empty groups never match — deliberately **not** vacuous truth for `all`, so a half-built group can't silently match everything. **No migration needed**: the old flat `{match: "all"|"any", conditions: RuleCondition[]}` is structurally valid in the new format (json-rules-engine-style; JsonLogic was considered and rejected as too generic/verbose). Rules are validated by `parseRuleGroup`/`parseFolders` in `shared/validation.ts` (used by the options JSON editors, folder import, and defensively by `getFolders`). A bookmark can appear in multiple folders. No "uncategorized" folder.

**Reordering rule conditions/groups AND folders (pointer-based drag, since 2026-07-05)**: `options.ts`'s `renderGroupEditor` makes each direct child reorderable by dragging its `.drag-handle` (⠿), scoped to **siblings within one group's own `conditions` array only** (no cross-group moves) — order has zero effect on match semantics (AND/OR/NOT don't care), it's purely editing convenience. `RuleCondition`/`RuleGroup` have no id field — reordering is index-based (splice/re-insert then `renderTabs()`, same as remove). **Folder reordering reuses the exact same mechanism** (`wireReorderHandle` is generic over any backing array — it takes `items: unknown[]`): each `.folder-editor` is a `.drag-row` with a handle first in its `.folder-header`, the sibling container is `.folders-list` (`position: relative` for the marker), and the backing array is `folders` itself. Folder array order IS the display order on every surface (popup/sidebar/newtab render `Folder[]` in storage order), so this needed no schema change — persisted on Save like everything else. **This uses Pointer Events, NOT native HTML5 drag-and-drop** (`wireReorderHandle`): `pointerdown` on the handle → `setPointerCapture` (guarded in try/catch — can throw on a stale pointer id) → `pointermove` computes the insert index from the pointer Y vs the rows' live `getBoundingClientRect` midpoints (pure helper `insertionIndexForY` in `shared/reorder.ts`, unit-tested) and positions a floating `.drop-marker` line → `pointerup` reorders (no-op if dropping before self or the slot right after) then `renderTabs()`. Rows carry a `.drag-row` class as the geometry query hook; `.conditions` is `position: relative` so the absolute marker sits in it; `.drag-handle` has `touch-action: none` so a touch drag reorders instead of scrolling. **⚠ Do NOT rewrite this as native HTML5 DnD** — it was tried twice (draggable on the row, then on the handle) and both silently failed in real Firefox: native DnD can't reliably *initiate* from a row full of form controls, gives no easy live drop marker, and doesn't work on touch. Both also *passed a headless synthetic-`DragEvent` test while broken*, because synthetic DragEvents bypass real drag initiation. The pointer-based version's logic (index math + reorder) IS exercised end-to-end by `pnpm verify:ui`.

**Open-all / open-in-background affordances (since 2026-07-05)**
- Folder middle-click ("open all in background tabs") was **mouse-only** — no equivalent on trackpads (no middle button) or touch. `renderFolderDetails` (`shared/folderList.ts`) now also renders an always-visible `.open-all-btn` icon button inside `<summary>` that calls the same `onOpenAll` callback; the `mousedown`/`button===1` middle-click handler is kept alongside it (both call the same callback — not a replacement). The button's click handler must `preventDefault()`/`stopPropagation()` first, since a click on any child of `<summary>` otherwise triggers the browser's native `<details>` toggle.
- Same gap existed per-bookmark (native anchor middle-click/auxclick). `renderBookmarkItem` now accepts an optional `onOpenBackground?: (bookmark) => void`; when provided, a small trailing `.open-bg-btn` renders per row. Wired in popup.ts (`active:false`, deliberately **no** `window.close()` — lets the user open several before closing themselves, unlike `onOpen`) and sidebar.ts (`active:false`, same shape as its existing `onOpenAll`).
- **New tab has both too (since this session, 2026-07-05)**: its bookmarks stay plain native anchors with no `onOpen` (so native middle-click/ctrl-click keep working unmodified — don't add one), but `onOpenBackground` is additive and wired (`active:false`). Newtab doesn't use `renderFolderDetails` (it renders `<section>/<h2>`), so its folder-level open-all is its own `.open-all-btn` inside the `<h2>` (plus middle-click on the heading for parity), calling `openAll()` in newtab.ts: opens all `safeFolderBookmarks` with `active:false`, then — only if `Settings.newTabCloseOnOpenAll` is true — closes its own tab via `tabs.getCurrent()`/`tabs.remove()` (NOT `window.close()`, unreliable for a tab the script didn't open). The setting (default **false** = launcher stays open) lives in the options Overview → "New Tab page" section and is read at click time, so no re-render is needed when it changes.
- `summary` gained `display:flex; justify-content:space-between` (needs a `.folder-name` span sibling now, can't be a bare `textContent` anymore) and `li` gained `display:flex` (the new button is a sibling of `a`, not nested in it) — mirrored 1:1 across popup.css/sidebar.css since those files' relevant rules were already near-duplicates, and now also in newtab.css (`h2` flex + `.folder-name` span, `li` flex, `a` flex:1). Icon-button look lives in `tokens.css` (`.open-all-btn`/`.open-bg-btn`, uses `--fg-muted`/`--hover-bg` tokens) so it's shared and themes correctly.

**Browser API abstraction**
- `shared/browser.ts` exports a single `ext` object — `browser` in Firefox, `chrome` in Chrome
- All code imports from there; no direct `browser.*` or `chrome.*` calls

**Compile-time browser base (since 2026-07-10)**
- `shared/browserBase.ts` exports `browserBase: "firefox" | "chromium"` — a **build-time constant**, not a runtime sniff. Fed by `webpack.config.ts`'s `DefinePlugin({ __BROWSER_BASE__: … })`, keyed on the existing `target` var (firefox → `firefox`; both chrome targets share `manifest.chrome.json` → `chromium`). Webpack constant-folds it to a bare literal, so it's tree-shakeable and works in the background service worker (where `location`/`typeof browser` sniffing is awkward). The module is **ext/DOM-free** (imported by `shared/bookmarks.ts` and unit tests); its `typeof __BROWSER_BASE__` guard falls back to `"chromium"` in the node test runner, where DefinePlugin never runs. Verify a build injected the right value by diffing the `"firefox"`/`"chromium"` literal counts in `dist/<target>/background.js` (each target gets one extra of its own base on top of the 2 static-folder rule values).
  - **Gotcha**: `webpack.config.ts` is loaded as ESM (ts-node), and `webpack` is CJS — so a named import `import { DefinePlugin } from "webpack"` fails at config load (`does not provide an export named 'DefinePlugin'`). Use the default import: `import webpack from "webpack"` then `new webpack.DefinePlugin(...)`. Any future webpack plugin pulled from the `webpack` package has the same constraint.

**URL scheme allowlist (security)**
- `shared/url.ts` — `isAllowedBookmarkUrl` (http/https/mailto/ftp **+ about:/chrome:** since 2026-07-10) and `isAllowedFaviconUrl` (http/https/data). `new URL()` alone accepts `javascript:`, which would run in a privileged extension page, so schemes are enforced at validation time (JSON provider) AND defensively at render time (newtab/popup/sidebar neuter bad links; favicon.ts ignores unsafe `favicon_url`). `about:`/`chrome:` are allowed because — unlike `javascript:`/`data:` — they never execute in the extension page; they only open in a tab.
- **Privileged-scheme opening**: `about:`/`chrome://` URLs can't be opened by a plain anchor click or `tabs.update()`. `isPrivilegedNavUrl(url)` (url.ts) flags both. They split by openability:
  - **`chrome://` (Chromium)** — opens via `tabs.create()` (proven by the onboarding page). Sidebar `onOpen` routes it to `tabs.create` (not `tabs.update`); popup already uses `tabs.create`; new tab uses the `onOpenPrivileged` callback below.
  - **`about:` (Firefox) is `isCopyOnlyUrl` — unopenable by ANY extension API.** Firefox forbids extensions from loading privileged `about:` pages (`about:debugging`, `about:config`, `about:addons`, `about:processes`): `tabs.create`/`tabs.update`/`windows.create` all reject and anchor clicks are inert (deliberate, unshipped-otherwise — Bugzilla 1356251/1269456). So clicking one **copies the URL to the clipboard + shows a hint toast** (`shared/copyHint.ts` → `copyBookmarkUrl`) so the user can paste it into the address bar (Ctrl+L). No `clipboardWrite` permission added — the user-gesture click suffices, and the toast always shows the URL as a manual fallback. "Open all" skips copy-only URLs (can't copy several at once).
  - `renderBookmarkItem`'s `onOpenPrivileged` intercepts **only** privileged-scheme rows on the new-tab surface (where there's no `onOpen`), so normal links keep native middle/ctrl-click; the callback then branches copy-only vs `tabs.create`. Each surface's `onOpen`/`onOpenBackground` checks `isCopyOnlyUrl` first.
  - Favicons for about:/chrome:// fall back to the letter-tile (no origin/`_favicon` result).
  - **⚠ Don't "fix" the Firefox about: bookmarks to open in a tab** — it's a hard Firefox restriction, not our bug; the copy fallback is the intended behaviour.

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
- `getFolders()` falls back to `STATIC_FOLDERS` when storage is empty (fresh install only — existing installs keep stored folders, so new static folders don't appear on upgrade)
- Default settings use a single static provider so the extension works out of the box
- **Browser-internal bookmarks** (ids 18–27, since 2026-07-10): Firefox pages (`about:debugging#/runtime/this-firefox`, `about:addons`, `about:config`, `about:processes`, `about:preferences`) tagged `["browser", "firefox"]`; Chromium pages (`chrome://extensions`, `chrome://inspect`, `chrome://flags`, `chrome://version`, `chrome://settings`) tagged `["browser", "chromium"]` (a shared `browser` group tag + a per-base tag). The `about:` Firefox pages are copy-only on click (Firefox blocks extensions from opening privileged `about:` pages → clipboard + toast fallback); the `chrome://` ones open via `tabs.create`. The `STATIC_FOLDERS` entry **"Browser tools"** (id …0005) shows only the current browser's set via `all( tag browser, any( all(browser_base=firefox, tag firefox), all(browser_base=chromium, tag chromium) ) )` — one always-non-empty folder rather than an empty per-browser folder on the other build.

## File map

```
shared/
  types.ts            — all TypeScript interfaces and the ProviderConfig union
  browser.ts          — Firefox/Chrome API shim
  browserBase.ts      — compile-time browserBase ("firefox"|"chromium") from
                        webpack DefinePlugin (ext/DOM-free; used by bookmarks.ts +
                        the browser_base condition; falls back to "chromium" in tests)
  storage.ts          — storage read/write helpers, storage warning logic
  bookmarks.ts        — bookmarksToMap, mergeIntoMap, matchesNode (recursive rule
                        evaluation), computeFolderMembership (applies Folder.limit),
                        latestN (newest-by-date), safeFolderBookmarks
                        (pure logic, unit-tested)
  folderList.ts       — shared folder/bookmark DOM rendering for popup/sidebar/newtab
                        (renderFolderDetails/renderBookmarkItem; open behaviour injected via callbacks)
  validation.ts       — validateBookmarks() + entryToBookmark() for the JSON provider;
                        parseJsonFeed() (JSON Feed mapping) + shared feed-title helpers
                        (deriveTitle/stripHtml/decodeEntities); parseRuleGroup()/parseFolders()
                        for folder rules (JSON editor, import, defensive getFolders)
  rss.ts              — parseXmlFeed() (RSS 2.0/0.9x, RDF, Atom → Bookmarks via
                        fast-xml-parser) + decodeFeedBytes() (XML-prolog encoding)
  reorder.ts          — insertionIndexForY() pure geometry helper for the
                        options page's pointer-based rule reordering (unit-tested)
  sync.ts             — pure sync-loop helpers (unit-tested): per-provider
                        scheduling (isDue/needsFullSync/effectiveIntervalMinutes/
                        alarmPeriodMinutes), providerFingerprint, slice merge
                        (applySyncResult/pruneBookmarks), maxModifiedCursor,
                        mergeSyncErrors, fnv1a
  folderSource.ts     — remote folder source (unit-tested, ext/DOM-free):
                        FOLDER_SOURCE_ID, fetchFolderSource (conditional GET +
                        content hash), folderSourceDue, nextFolderSourceState
  syncFoldersButton.ts — wires the surfaces' hidden #sync-folders button
                        (visibility from settings, click → sync_provider with
                        FOLDER_SOURCE_ID); separate from folderSource.ts so
                        that one stays importable in node tests (no ext)
  buildInfo.ts        — pure buildKind(version) → release|branch|dirty
                        (ext-free, unit-tested; see the dev-build ribbon under
                        Build & tooling)
  buildBadge.ts       — installedVersion() + applyBuildBadge() (ext/DOM): the
                        dev-build ribbon injected into #app on every surface
  copyHint.ts         — copyBookmarkUrl() (DOM): clipboard + hint-toast fallback for
                        URLs the extension can't open (Firefox privileged about: pages)
  providers/
    index.ts          — createProvider(config) factory
    static.ts         — StaticProvider
    json.ts           — JsonProvider
    browser.ts        — BrowserProvider (chrome.bookmarks, requests permission lazily)
    linkding.ts       — LinkdingProvider (paginated Linkding REST API)
    feed.ts           — FeedProvider (web feed URL; sniffs JSON Feed vs RSS/Atom,
                        encoding-aware decode; mappings in validation.ts / rss.ts)
  data/
    static.ts         — STATIC_BOOKMARKS (27 items, incl. browser-internal about:/chrome:// pages)
                        + STATIC_FOLDERS (Crowdsourcing, Fediverse, plus nested-rule showcases:
                        "Community (not social media nor crowdsourcing)" = community AND NOT
                        (social-media OR crowdsourcing), "Open knowledge" = knowledge AND
                        (education OR opensource), "Browser tools" = tag browser AND per-base
                        browser_base + firefox/chromium tag)

src/
  background/background.ts   — service worker: provider loop, alarms, message handler
  newtab/newtab.ts           — <section>/<h2> folder layout; bookmarks via shared
                               renderBookmarkItem (native anchors); storage change listener
  newtab/newtab.html/css
  popup/popup.ts             — shared renderFolderDetails; left-click opens new tabs and
                               closes the popup; onOpenBackground opens a background tab
                               without closing (lets the user open several); onOpenAll
                               (button or middle-click) opens all + closes
  popup/popup.html/css
  sidebar/sidebar.ts         — shared renderFolderDetails; left-click navigates current
                               tab; onOpenBackground/onOpenAll (button or middle-click)
                               both open background tabs, sidebar never closes;
                               Chromium side-panel toggle port
  sidebar/sidebar.html/css
  options/options.ts         — provider management UI + recursive folder/rule editor,
                               per-folder JSON editor, folder export/import (replace-all,
                               staged in memory until Save), collapsed boolean-logic +
                               sort/weight help. Opens in its OWN TAB
                               (manifest options_ui.open_in_tab:true, since 2026-07-05) —
                               Firefox otherwise embeds it in a cramped ~630px about:addons
                               panel; the folder rule rows need the room. body max-width 960px.
  options/options.html/css
  onboarding/onboarding.ts   — first-run welcome page, runtime-tailored per browser/target
  onboarding/onboarding.html/css

tests/                       — node:test unit tests for shared/ pure modules (run in pnpm build)

manifests/
  manifest.shared.json       — common to all targets (no version field; injected from package.json at build)
  manifest.chrome.json       — Chrome-only: background.service_worker + favicon/sidePanel/unlimitedStorage
  manifest.firefox.json      — Firefox-only: background.scripts + browser_specific_settings + chrome_url_overrides.newtab + chrome_settings_overrides.homepage (new windows / Home button → launcher)
  manifest.chrome-newtab.json — overlay for the chrome-newtab target: adds newtab override + renames to "(new tab edition)"
  (build deep-merges a target's manifest list in order; arrays are unioned — see TARGET_MANIFESTS in webpack.config.ts)

public/icons/
  icon.svg                   — icon source (paperclip + "+" on linkding violet); PNGs rasterised from it
  icon48.png / icon128.png   — shipped icons (see Build & tooling for the rsvg-convert command)

webpack.config.ts            — parameterised by --env target=firefox|chrome|chrome-newtab;
                               DefinePlugin injects __BROWSER_BASE__ (see shared/browserBase.ts);
                               @shared/* alias resolves to shared/
```

## Linkding API notes

Base URL: user-configured per provider. Auth: `Authorization: Token <token>` header.

Pagination: follows `next` links until exhausted (100 results per page).

## What's missing / next steps

**Functional gaps**
- [x] ~~Run `pnpm verify:ui` once outside the sandbox~~ — ran clean 2026-07-07 (all v1.1.6 driver checks pass), and the command is now in the workspace's sandbox `excludedCommands`, so it runs unsandboxed from Claude sessions too (see Build & tooling)
- [x] ~~Deletion handling for removed providers~~ — `pruneBookmarks` drops inactive providers' slices after every sync round (2026-07-05)
- [ ] Manual JSON import UI — `validateBookmarks()` exists in `validation.ts` and the options page has a JSON textarea, but there's no live validation feedback shown to the user
- [x] ~~Per-provider incremental sync~~ — linkding `modified_since` + feed conditional GET, with a daily full sync reconciling deletions (see Sync flow, 2026-07-05)
- [x] ~~Options page host permission for Linkding URLs~~ — requested on Save, scoped to the configured origin (see README "Linkding connection & permissions")
- [x] ~~Real icons~~ — paperclip+"+" `icon.svg` created and rasterised (see Build & tooling)
- [x] ~~CSS placeholder~~ — shared `:root` token set in `src/tokens.css`, light/dark/system themes
- [x] ~~Error state UI when sync fails~~ — sync error banner (see Architecture)

**Nice to have**
- [x] ~~Folder ordering (drag to reorder)~~ — done 2026-07-05, same pointer-drag as rule conditions (see "Reordering rule conditions/groups AND folders" above)
- [x] ~~Bookmark ordering within folders~~ — `Folder.sort` + per-condition `weight` (see "Folder display ordering" above)
- [ ] Search/filter within the new tab page
- [ ] "Open in Linkding" context on individual bookmarks
- [ ] Error state UI when sync fails
- [ ] Show last sync timestamp in the new tab header

## Code style notes

- All variable names, comments, and output strings in English
- Prefer explicit types over inference where it aids readability
- No default exports except `shared/browser.ts`
- CSS colours go through the `src/tokens.css` `:root` tokens (`var(--bg)` etc.) — don't reintroduce hardcoded hex in page CSS, or light/dark theming breaks
