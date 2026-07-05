# Release & store-submission notes

Working notes for publishing **Bookmarks+** to the Firefox Add-ons store (AMO) and
the Chrome Web Store (CWS). Pairs with `CLAUDE.md` (architecture) and `PRIVACY.md`
(privacy policy). Last worked: 2026-07-05.

## Current status

- **Version:** 1.1.5 (single source of truth = `package.json`; injected into each
  manifest at build). 1.1.5 = sync rework + launcher affordances:
  **per-provider sync scheduling** (optional interval override on Linkding /
  feed / browser-bookmarks tabs; alarm follows the fastest interval),
  **incremental sync** (Linkding via `modified_since` with a server-clock
  cursor; feeds via HTTP conditional GET, 304 = skip download+parse) with a
  **configurable full-sync ceiling** (`fullSyncIntervalHours`, default 24 —
  partial updates can't see deletions/archiving, this bounds their staleness;
  wall-clock so sleep/power-off time counts), a per-provider **"Sync now"**
  button (Overview + provider tab; syncs last-saved settings), **"Last
  synced"** shown per provider, **drag-to-reorder folders** (same pointer
  mechanism as rule conditions), **New Tab open-in-background buttons**
  (per bookmark + per folder open-all, with an optional "close the New Tab
  page after open-all" setting, default keep open), removed providers'
  bookmarks now pruned immediately, and a bug fix: **sync-interval changes now
  take effect immediately** (the alarm was only created at install time).
  **No new permissions, no new dependencies.**
  1.1.4 = folder display ordering + reordering + open
  affordances: per-folder **Sort** (newest added / recently modified /
  alphabetical) and per-condition **Weight** on OR (ANY) rules with 2+
  conditions (weight ranks matches, primary; sort is the tiebreak);
  `Bookmark.dateModified` (linkding `date_modified`) added to drive "recently
  modified". **Drag to reorder** rule conditions/groups within a group
  (pointer-based, live drop marker, touch-friendly). **"Open all in background
  tabs"** button on folders + **"open in background"** button per bookmark
  (works on trackpads/touch, supplements the existing middle-click). Options
  page now **opens in its own tab** (`open_in_tab: true`, wider — the rule
  editor needs the room). Internal only: pointer-based reorder replaced an
  unreliable native-DnD attempt, and a `pnpm verify:ui` headless UI regression
  harness was added. **No new permissions, no new dependencies.**
  1.1.3 = RSS/Atom support, dates & limits: the JSON Feed
  provider became a unified **"Web feed"** provider (config type `feed`;
  `jsonfeed` kept as legacy alias) that auto-detects RSS 2.0/0.9x, RSS 1.0
  (RDF), Atom 1.0, or JSON Feed; categories become tags; XML-prolog encoding
  honoured (iso-8859-1 feeds). **First runtime dependency: `fast-xml-parser`
  (MIT)** — needed because Chrome's MV3 service worker has no DOMParser; ships
  as readable source in the unminified build (mention in AMO reviewer note if
  asked about third-party code). Plus `Bookmark.date` (ISO, from every provider
  that knows it), per-folder **"Latest N"** limit (newest matches by date,
  undated last; "Latest [All]" input in the folder header), per-feed **max
  items** cap, and an honest provider panel (shows synced link count, live-feed
  wording for feeds, "no tags" no longer claims "no bookmarks").
  1.1.2 = JSON Feed provider: subscribe to a feed URL, its
  current items show as bookmarks (mirrors the feed each sync); linkblog
  `external_url` preference (checkbox, default on), title fallback for untitled
  microblog posts, feed favicon, host permission requested on Save like
  Linkding. 1.1.1 = new `provider` folder-rule condition: match
  bookmarks by their source provider (options editor shows a dropdown of
  configured providers), so per-source folders work even when a source supplies
  no tags. 1.1.0 = nested folder rules: rule groups nest arbitrarily
  (`A AND (B OR C)`), new "Match NONE (exclude)" mode, per-folder "Edit as JSON",
  export/import of all folder definitions as JSON (replace-all), options-page
  header (logo + version, upper right), two nested-rule demo folders in the
  static data ("Community (not social media nor crowdsourcing)", "Open knowledge"), and a
  collapsed boolean-logic help (`<details>`) on the Folders tab. Old flat
  rules load unchanged (no migration). 1.0.2 was pre-submission cleanup: shared
  folder-rendering helper (`shared/folderList.ts`), unit tests wired into
  `pnpm build`, doc fixes. **1.1.4 is the last published version** (AMO:
  https://addons.mozilla.org/en-US/firefox/addon/bookmarks-plus/ — Approved
  2026-07-05); the 1.1.5 upload therefore ships only the 1.1.5 changes above —
  see "Version notes for the 1.1.5 upload" below.
- **Code state:** `pnpm build` (type-check + 98 tests + 3 targets) clean; `pnpm
  verify:ui` (headless UI regression, 4 surfaces) green; feed conditional GET
  verified live (xkcd ETag → 304), linkding `modified_since` + pagination
  verified against a local mock of the API. Before upload: **smoke-test the
  incremental sync against the real linkding instance** (no credentials on the
  dev workstation — load the build, sync twice, background console should show
  `incremental` on the second), and re-run `web-ext lint` (0 errors expected).
- **NOT yet done:** `git push` + `git push --tags`, and the actual store
  uploads (both the user's).

## Build & package (recap — details in CLAUDE.md)

```bash
pnpm package      # builds all 3 targets (production, NOT minified, no source maps)
                  # + zips them to web-store/bookmarks-plus-<target>-<version>.zip
pnpm screenshots  # regenerates web-store/screenshots/*.png (1280x800)
```

**Build from a clean `main` checkout.** Off-main or dirty builds get a git-decorated
version (`1.1.3-<hash>`, `…-SNAPSHOT`) baked into the zip filename *and* the manifest
(Chromium: `version_name`; Firefox: `version` itself) — instantly recognizable as
not-for-upload. Clean main produces the plain store-safe version everywhere.

`web-store/` is gitignored — artifacts are regenerated, not committed.

Three upload artifacts → **three listings across two stores**:

| Zip | Store / listing |
|---|---|
| `bookmarks-plus-firefox-<v>.zip` | AMO — "Bookmarks+" |
| `bookmarks-plus-chrome-<v>.zip` | CWS — "Bookmarks+" (leaves native new tab alone) |
| `bookmarks-plus-chrome-newtab-<v>.zip` | CWS — "Bookmarks+ (new tab edition)" |

## What was done in the polish session (2026-06-30)

- **Security:** URL-scheme allowlist (`shared/url.ts`) at validation + render time
  (blocks `javascript:`/`data:`); `DEBUG` flag (`shared/debug.ts`) gates verbose
  logging that previously dumped the bookmark tree.
- **Themes:** system/light/dark via `shared/theme.ts` + `src/tokens.css` token set;
  picker in options "Appearance".
- **Sync error banner:** background records `syncStatus`; `shared/syncBanner.ts`
  renders it on newtab/popup/sidebar.
- **Manifests:** `minimum_chrome_version: 114` (Chrome); Firefox
  `data_collection_permissions: { required: ["none"] }`.
- **Build:** production mode, **not minified** (AMO advice), no source maps; zip
  packaging (`scripts/package.mjs`); screenshot pipeline
  (`scripts/screenshots.mjs` + `screenshot-harness.js`).
- **Icon:** `public/icons/icon.svg` — white paperclip + "+" badge on linkding
  violet `#5856e0`; rasterised to icon48/128.png.
- **onboarding.ts:** refactored off `innerHTML` (cleared AMO warnings).
- **options.ts:** static-provider note links to the demo data
  (`STATIC_DATA_URL`).
- **License:** MIT (`LICENSE`, `package.json`). **Privacy:** `PRIVACY.md`.

## Known lint warnings (all benign, 0 errors)

1. `UNSUPPORTED_API sidePanel.open` — guarded Chrome-only code in the shared
   background bundle; never runs in Firefox (`if (chrome.sidePanel) …`).
2. + 3. `data_collection_permissions` "unsupported below FF 140" — the key needs
   Firefox 140; our floor is `strict_min_version: 128` (ESR). Key is correct and
   forward-compatible (inert <140, honoured ≥140). **Decision: keep min 128**, do
   not raise it just to clear these.

## Submission checklist

### Both stores
- [ ] Verify the `STATIC_DATA_URL` in `src/options/options.ts` matches the real
      published repo. Currently `github.com/mkoester/Bookmarks-plus` @ `main` →
      `shared/data/static.ts`. **404s if owner/repo/branch differ.**
- [ ] Host `PRIVACY.md` somewhere linkable (GitHub raw/Pages) and use that URL.
- [ ] Screenshots: `web-store/screenshots/` (5x 1280x800). One set covers both
      stores (sidebar caption says "sidebar / side panel"). See "Firefox question"
      note: only real divergence is favicons (we use deterministic letter tiles, so
      it's a fair representation of both).
- [ ] **After the uploads, on `develop` only:** bump the patch version in
      `package.json` — `develop` then carries the next release's version, while
      `main`'s version only changes when a release is merged into it;
      intermediate builds stay identifiable via the git-decorated version
      (no bump-per-test-build).

### AMO (Firefox)
- [ ] Upload `bookmarks-plus-firefox-<v>.zip`.
- [ ] Optional: `pnpm dlx web-ext lint -s dist/firefox` before upload.
- [ ] Data-collection form: declare **no data collected**.
- [ ] Paste the reviewer note (below).

### Chrome Web Store (two listings)
- [ ] Upload `bookmarks-plus-chrome-<v>.zip` (primary) and
      `bookmarks-plus-chrome-newtab-<v>.zip` (second listing).
- [ ] Privacy practices tab: single purpose = bookmark launcher; justify
      permissions; declare no data sale/transfer.
- [ ] $5 one-time developer registration (if not already).
- [ ] Paste the reviewer note (below).

## Version notes for the 1.1.5 upload (everything since published 1.1.4)

Paste into AMO "Release notes" (reuse for any CWS listing description update —
CWS has no changelog field). No new permissions and no new dependencies, so the
review surface is unchanged.

> - **Faster, lighter sync**: Linkding syncs now only fetch what changed since
>   the last sync; web feeds use standard HTTP caching (ETag) and skip the
>   download entirely when nothing changed. A periodic full sync (default:
>   every 24 hours, configurable per source) still catches deletions.
> - **Per-source sync intervals** — give a busy feed its own faster (or slower)
>   schedule, independent of the global interval.
> - **"Sync now" button** on each source, plus a "last synced" timestamp.
> - **Drag to reorder folders** — the launcher shows them in your order.
> - **New Tab page**: open a single bookmark or a whole folder in background
>   tabs with one click (as in the popup/sidebar); optionally close the New Tab
>   page after opening a whole folder.
> - Fixed: changes to the sync interval now apply immediately.

## Version notes for the 1.1.4 upload (everything since published 1.1.3)

Paste into AMO "Release notes" (reuse for any CWS listing description update —
CWS has no changelog field). No new permissions and no new dependencies, so the
review surface is unchanged from 1.1.3.

> - **Sort each folder** — newest added, recently modified, or alphabetical.
> - **Weight your OR-rules** — when a folder matches on any of several
>   conditions, give some more weight so their bookmarks rank higher.
> - **Drag to reorder** the conditions in a folder's rules.
> - **Open a whole folder in background tabs** with one button, or open a single
>   bookmark in the background — no longer just middle-click, so it works on
>   trackpads and touch too.
> - **Settings now open in their own tab**, with more room for the rule editor.

## Version notes for the 1.1.3 upload (everything since published 1.1.0)

Paste into AMO "Release notes" (and reuse for any CWS listing description
update — CWS has no changelog field):

> **New bookmark source: Web feeds.** Subscribe to any RSS (2.0 or 1.0), Atom,
> or JSON Feed URL — the format is detected automatically. The feed's current
> items appear as bookmarks and the list mirrors the feed on every sync; feed
> categories become tags.
>
> - **New folder rule condition: Provider** — collect everything from one
>   source into a folder (picked from a dropdown of your configured sources),
>   even when it has no tags.
> - **"Latest" folder limit** — show only the newest N matching items. Every
>   source now syncs per-item dates to make this work.
> - **Per-feed "maximum items" cap** for feeds that ship a lot of entries.
> - **Linkblog-friendly**: JSON Feeds that point posts at an external article
>   (e.g. Daring Fireball) can bookmark the linked page instead of the post.
> - Provider pages in the options now show how many links are synced and
>   explain that feed items are a live list, not stored bookmarks.
> - Feeds in legacy encodings (e.g. ISO-8859-1) decode correctly.

## Store listing copy

### Description — Bookmarks+ (Firefox / AMO)

> **Bookmarks+ turns your bookmarks into a fast, folder-based launcher — in your sidebar, your toolbar popup, and (optionally) your New Tab page.**
>
> Define folders with simple rules ("tag is *reading*", "URL contains *github*", "comes from *this source*", title contains…) and Bookmarks+ fills them automatically. Combine and nest rules with AND/OR/NOT; a bookmark can live in several folders at once. Optionally show only the latest N items per folder, and sort each folder by date or name.
>
> **Sources you can mix and match:**
> • **Linkding** — sync your self-hosted Linkding instance via its REST API (token auth)
> • **Web feeds** — follow any RSS, Atom, or JSON Feed as a live folder of its current links (categories become tags)
> • **Your browser's own bookmarks** — folder names become tags
> • **JSON** — paste your own list
> • **Demo data** — try it instantly, no setup
>
> Background sync keeps everything current on a timer you control — per-source intervals, incremental where the source supports it, and a "Sync now" button. Open a whole folder in background tabs with one button (or middle-click), or open a single bookmark in the background. Per-site favicons with clean letter-tile fallbacks.
>
> **Privacy:** your data stays in your browser. The only network requests are to the Linkding instance and the feeds *you* configure — host access is requested per origin and nothing else.

### Description — Bookmarks+ (Chrome, standard build)

> **Quick access to your bookmarks from a toolbar popup and a side panel — without touching your New Tab page.**
>
> Bookmarks+ organizes your bookmarks into folders defined by rules (by tag, URL, title, or source, nested with AND/OR/NOT; optional "latest N" per folder, sortable by date or name). Open the popup from the toolbar, or press **Ctrl+Shift+S** for the side panel. Open a whole folder in background tabs with one button.
>
> **Sources:** Linkding (self-hosted, REST API token auth), web feeds (RSS / Atom / JSON Feed as a live folder of a site's current links), your browser's own bookmarks (folder names become tags), pasted JSON, or built-in demo data — mix as many as you like. Background sync on a timer you set, with per-source intervals and a "Sync now" button.
>
> Prefer your New Tab page replaced too? Install **"Bookmarks+ (new tab edition)"** instead.
>
> **Privacy:** everything stays local; the only requests go to the Linkding instance and feeds you configure, with host access scoped to those origins.

### Description — Bookmarks+ (new tab edition) (Chrome)

> **Your bookmarks as a launcher every time you open a new tab — plus a toolbar popup and a side panel.**
>
> Same Bookmarks+ as the standard build, but this edition also replaces your New Tab page with your folder-based launcher. Folders are defined by rules (tag / URL / title / source, nested AND/OR/NOT, optional "latest N"); a bookmark can appear in several.
>
> **Sources:** Linkding (self-hosted REST API, token auth), web feeds (RSS / Atom / JSON Feed as a live folder), your browser's own bookmarks (folders → tags), pasted JSON, or demo data. Background sync on your schedule — per-source intervals, "Sync now" button. Side panel on **Ctrl+Shift+S**.
>
> Want to keep Chrome's native New Tab? Install the standard **"Bookmarks+"** build instead.
>
> **Privacy:** your data never leaves the browser except to reach the Linkding instance and feeds you configure, with host access scoped to those origins.

## Reviewer note (paste into AMO / CWS "notes to reviewer")

> **About the `<all_urls>` optional host permission**
>
> This is declared under `optional_host_permissions` — it is **not** granted at install. It is requested at runtime, **only when the user saves a provider that fetches from a URL** (their self-hosted Linkding instance, or a web feed they subscribe to), and is narrowed to **exactly the origin the user typed** (e.g. `https://links.example.com/*`) via `permissions.request({ origins: [<that one host>] })`. See `src/options/options.ts` → `save()` and `remoteProviderOrigins()`.
>
> The manifest pattern has to be broad because these hosts are **user-supplied** and unknown at build time, and MV3 provides no way to declare a dynamic/user-defined host pattern. The effective grant is always a set of single concrete hosts. The extension has **no content scripts** and never reads page content; the host permission is used solely for the extension's own `fetch()` calls to the user's Linkding REST API and the user's configured feed URLs (cross-origin CORS).
>
> Users can review and revoke each granted host in the extension's options ("Permissions" tab) or the browser's add-on settings.
>
> **Bundled third-party code:** `fast-xml-parser` (MIT, from npm, unmodified) is included in the background bundle to parse RSS/Atom feeds — MV3 service workers have no `DOMParser`. The build is deliberately **not minified**, so the library ships as readable source inside `background.js`.
>
> **Also note:** the shared background bundle references `chrome.sidePanel.open` (a Chrome-only API), guarded by a runtime `if (chrome.sidePanel)` check so it never executes in Firefox. This is the source of the `UNSUPPORTED_API` lint warning.

## Open / optional follow-ups

- [ ] Pretty favicons in screenshots: seed demo bookmarks with `favicon_url` (would
      then warrant capturing the Firefox build in Firefox, since Chrome's favicon
      API flatters Firefox). Currently letter tiles → fair for both.
- [ ] Optional Firefox-captioned screenshot variant (currently shared "sidebar /
      side panel" wording).
- [ ] From CLAUDE.md backlog: live JSON validation feedback in options;
      optional_host_permission requested without `<all_urls>` if MV3 ever
      allows. (~~Deletion handling when a provider is removed~~ and
      ~~per-provider incremental sync~~ shipped in 1.1.5.)
