# Release & store-submission notes

Working notes for publishing **Bookmarks+** to the Firefox Add-ons store (AMO) and
the Chrome Web Store (CWS). Pairs with `CLAUDE.md` (architecture) and `PRIVACY.md`
(privacy policy). Last worked: 2026-07-04.

## Current status

- **Version:** 1.1.3 (single source of truth = `package.json`; injected into each
  manifest at build). 1.1.3 = RSS/Atom support, dates & limits: the JSON Feed
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
  `pnpm build`, doc fixes. **1.1.0 is the last published version** (AMO:
  https://addons.mozilla.org/en-US/firefox/addon/bookmarks-plus/); the 1.1.3
  upload therefore ships everything from 1.1.1–1.1.3 — see "Version notes for
  the 1.1.3 upload" below.
- **Code state:** release-ready pending a manual re-test in both browsers (the
  render code was refactored). `pnpm build` (type-check + tests + 3 targets)
  clean. AMO `web-ext lint`: **0 errors, 3 benign warnings** (see below).
- **NOT yet done:** git commit (user does this themselves), and the actual store
  uploads.

## Build & package (recap — details in CLAUDE.md)

```bash
pnpm package      # builds all 3 targets (production, NOT minified, no source maps)
                  # + zips them to web-store/bookmarks-plus-<target>-<version>.zip
pnpm screenshots  # regenerates web-store/screenshots/*.png (1280x800)
```

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
      published repo. Currently `github.com/mkoester/linkding-ext` @ `main` →
      `shared/data/static.ts`. **404s if owner/repo/branch differ.**
- [ ] Host `PRIVACY.md` somewhere linkable (GitHub raw/Pages) and use that URL.
- [ ] Screenshots: `web-store/screenshots/` (5x 1280x800). One set covers both
      stores (sidebar caption says "sidebar / side panel"). See "Firefox question"
      note: only real divergence is favicons (we use deterministic letter tiles, so
      it's a fair representation of both).

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
> Define folders with simple rules ("tag is *reading*", "URL contains *github*", "comes from *this source*", title contains…) and Bookmarks+ fills them automatically. Combine and nest rules with AND/OR/NOT; a bookmark can live in several folders at once. Optionally show only the latest N items per folder.
>
> **Sources you can mix and match:**
> • **Linkding** — sync your self-hosted Linkding instance via its REST API (token auth)
> • **Web feeds** — follow any RSS, Atom, or JSON Feed as a live folder of its current links (categories become tags)
> • **Your browser's own bookmarks** — folder names become tags
> • **JSON** — paste your own list
> • **Demo data** — try it instantly, no setup
>
> Background sync keeps everything current on a timer you control. Middle-click a folder to open everything in it at once. Per-site favicons with clean letter-tile fallbacks.
>
> **Privacy:** your data stays in your browser. The only network requests are to the Linkding instance and the feeds *you* configure — host access is requested per origin and nothing else.

### Description — Bookmarks+ (Chrome, standard build)

> **Quick access to your bookmarks from a toolbar popup and a side panel — without touching your New Tab page.**
>
> Bookmarks+ organizes your bookmarks into folders defined by rules (by tag, URL, title, or source, nested with AND/OR/NOT; optional "latest N" per folder). Open the popup from the toolbar, or press **Ctrl+Shift+S** for the side panel.
>
> **Sources:** Linkding (self-hosted, REST API token auth), web feeds (RSS / Atom / JSON Feed as a live folder of a site's current links), your browser's own bookmarks (folder names become tags), pasted JSON, or built-in demo data — mix as many as you like. Background sync on a timer you set.
>
> Prefer your New Tab page replaced too? Install **"Bookmarks+ (new tab edition)"** instead.
>
> **Privacy:** everything stays local; the only requests go to the Linkding instance and feeds you configure, with host access scoped to those origins.

### Description — Bookmarks+ (new tab edition) (Chrome)

> **Your bookmarks as a launcher every time you open a new tab — plus a toolbar popup and a side panel.**
>
> Same Bookmarks+ as the standard build, but this edition also replaces your New Tab page with your folder-based launcher. Folders are defined by rules (tag / URL / title / source, nested AND/OR/NOT, optional "latest N"); a bookmark can appear in several.
>
> **Sources:** Linkding (self-hosted REST API, token auth), web feeds (RSS / Atom / JSON Feed as a live folder), your browser's own bookmarks (folders → tags), pasted JSON, or demo data. Background sync on your schedule. Side panel on **Ctrl+Shift+S**.
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
- [ ] From CLAUDE.md backlog: deletion handling when a provider is removed; live
      JSON validation feedback in options; per-provider incremental sync;
      optional_host_permission requested without `<all_urls>` if MV3 ever allows.
