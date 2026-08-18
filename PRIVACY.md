# Bookmarks+ — Privacy Policy

_Last updated: 2026-06-30_

**Bookmarks+ does not collect, transmit, or sell any personal data.** Everything stays on your device, except for requests the extension makes directly to the Linkding server you configure.

## What the extension handles

Depending on which sources you enable, Bookmarks+ processes:

- Bookmarks from your self-hosted **Linkding** instance, plus the **URL and API token** you enter to reach it.
- Your **browser's own bookmarks** — only if you grant the optional `bookmarks` permission.
- Bookmarks you paste as **JSON**.
- Your extension **settings** (folder rules, sync interval, theme).

## Where it is stored

All of the above is stored **locally** in your browser via the extension storage API (`storage.local`). None of it is sent to the developer or to any third party.

## Network activity

The only network requests Bookmarks+ makes are to the **Linkding server address you configure**, in order to read your bookmarks using your API token. No other hosts are contacted. The Linkding host permission is requested at runtime and scoped to exactly that origin.

## What we do NOT do

- No analytics or telemetry.
- No tracking or profiling.
- No advertising.
- No selling or sharing of data.
- No remotely hosted or executed code.

## Permissions

| Permission | Why |
|---|---|
| `storage`, `alarms` | Save your settings and schedule background sync |
| `unlimitedStorage` (Chrome) | Store large bookmark collections |
| `bookmarks` (optional) | Only if you import your browser's bookmarks |
| Host access (optional) | Only the Linkding origin you enter — requested at runtime, never `<all_urls>` in practice |
| `favicon`, `sidePanel` (Chrome) | Favicons and the side-panel UI |

You can review and revoke any granted host permission from the extension's options ("Permissions" tab) or your browser's add-on settings.
