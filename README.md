# linkding-ext

Browser extension for [Linkding](https://github.com/sissbruecker/linkding) — displays your bookmarks as a customizable folder-based launcher on the New Tab page and popup.

## Features

- New Tab page with configurable bookmark folders
- Popup for quick access
- Folder rules: match bookmarks by tag, URL, or title (AND/OR combinations)
- Incremental sync via Linkding's `modified_since` API
- Background sync on timer + on New Tab open
- Import your browser's own bookmarks (folder names become tags)
- Static demo data mode (no Linkding instance needed)
- Firefox + Chrome from one codebase

## Development

```bash
pnpm install

# Chrome (watch mode)
pnpm run dev:chrome

# Firefox (watch mode)
pnpm run dev:firefox
```

Output lands in `dist/chrome/` or `dist/firefox/`.

### Load in browser

**Chrome**: `chrome://extensions` → Enable developer mode → Load unpacked → select `dist/chrome/`

**Firefox**: `about:debugging` → This Firefox → Load Temporary Add-on → select `dist/firefox/manifest.json`

## Build

```bash
pnpm build           # both browsers
pnpm run build:chrome
pnpm run build:firefox
```

### Versioning

The version lives in **`package.json` only**. It's injected into each browser's
`manifest.json` at build time ([webpack.config.ts](webpack.config.ts)), so the manifests
carry no `version` field of their own. To release, bump it in one place:

```bash
pnpm version patch   # or edit package.json "version"
```

## Project structure

```
shared/          # All shared logic (types, storage, bookmarks, API, validation)
  data/          # Static mock bookmark data
src/
  background/    # Service worker — sync logic, alarms, message handling
  newtab/        # New Tab override page
  popup/         # Toolbar popup
  options/       # Settings + folder rule editor
manifests/       # Per-browser manifests (chrome/firefox)
public/icons/    # Extension icons (add icon48.png + icon128.png)
```

## Configuration

Open the extension options to:
- Set your Linkding URL and API token (+ optional username, see below)
- Configure the sync interval
- Toggle static demo data mode
- Import browser bookmarks (requests the `bookmarks` permission)
- Define bookmark folders with match rules

### Linkding connection & permissions

Authentication is **token only** — `Authorization: Token <token>`. The Linkding REST API
does not use the username; the **username field is a display-only label** and is never sent.
(Get a token in Linkding under Settings → Integrations → REST API.)

The username/session of your logged-in browser **cannot** be reused (unlike the old
Tampermonkey userscript): an extension's requests are cross-origin to your Linkding host, so
the `SameSite=Lax` session cookie isn't sent. Token auth is the supported path and works in a
fresh profile / background sync regardless of login state.

On **Save**, the options page requests host permission for exactly your configured Linkding
origin (e.g. `https://links.example.com/*`), bundled with the `bookmarks` request into a single
prompt. This host permission is what lets the extension read the API cross-origin (it grants a
CORS bypass for the extension's own fetches). Without it you'd see a `CORS header
'Access-Control-Allow-Origin' missing` / `401` failure.

> **Firefox quirk:** because the manifest declares the optional host permission as `<all_urls>`,
> a grant scoped to a single host is stored and active but does **not** appear in about:addons →
> Permissions (the "Access your data for all websites" toggle stays off, and the specific host
> isn't listed). Confirm it from the extension console with `browser.permissions.getAll()`.
> Re-saving an existing Linkding provider after upgrading triggers the host-permission prompt
> once.

### Pagination

The Linkding provider fetches **all** bookmarks by following the API's `next` link
(`/api/bookmarks/?limit=100`). Note Linkding has **no `tag` query parameter** — tag filtering
is done via the search query (`?q=%23tagname`), not `?tag=`. The provider doesn't filter by
tag, so this doesn't apply here, but it's the gotcha behind tag-filtered fetches elsewhere.

### Browser bookmark tags

The browser-bookmarks provider tags each imported bookmark with the **names of the
folders it lives in** — a bookmark under `Bookmarks Toolbar / crowdsourcing` gets the
tags `Bookmarks Toolbar` and `crowdsourcing`. To match a folder rule by tag, put the
bookmark inside a folder of that name.

Firefox's native bookmark tags (the tag field in the Edit Bookmark dialog) are **not**
readable from an extension — the WebExtension API only exposes the folder structure, so
only folder names can become tags.

## Icons

Add `icon48.png` and `icon128.png` to `public/icons/` before building.
