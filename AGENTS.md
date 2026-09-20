# Bookmarks+

A browser extension surfacing bookmarks as a folder-based launcher, across Firefox and Chrome from
one TypeScript codebase. Surfaces: toolbar popup, sidebar/side panel, and an optional New Tab
override. Supports multiple bookmark sources (providers), linkding among them.

Cross-project conventions come from the OKF vault; workspace rules from `../AGENTS.md`.
**The full reasoning behind every decision below, the annotated file map and the linkding API notes
are in `docs/design-notes.md`** — read it before changing anything it explains.

## Build and tooling

**pnpm, never npm** (`package-lock.json` is gitignored).

| Command | Notes |
|---|---|
| `pnpm type-check` | `tsc --noEmit`, should be clean |
| `pnpm test` | `node --test` + `tsx`, no framework. Covers pure `shared/` modules only |
| `pnpm verify:ui` | headless UI regression the unit tests cannot reach |
| `pnpm build` | type-check + tests first, then all three targets |
| `pnpm package` | builds, then zips per target into gitignored `web-store/` |

- **Unit tests must stay free of DOM and `ext` imports** — `shared/browser.ts` throws outside an
  extension context.
- **`pnpm verify:ui` must be run bare**, never inside a `&&` chain or pipe. Chromium cannot launch
  in the sandbox, so that exact string is in the workspace's `excludedCommands`; any other shape
  fails to match the exclusion.
- **Production builds are deliberately not minified** (`optimization.minimize: false`) — AMO
  advises against it and it buys nothing for local extension code.
- Add a `scripts/ui-verify/` driver check whenever you add UI a unit test cannot cover. Synthetic
  events drive handler logic and the DOM genuinely, but cannot validate native browser gestures.

## ⚠ Architecture decisions — already made, do not revisit

- **The New Tab override is static and cannot be toggled at runtime** — no API exists, and neither
  browser lets an override page redirect back to the native new tab. That is why it is split by
  **build target** rather than by setting: Firefox has it, the standard Chromium build omits it,
  and `chrome-newtab` ships it as a separately-named edition. The reason is that only Firefox gives
  the user a clean revert.
- **`about:` URLs in Firefox are `isCopyOnlyUrl` — unopenable by *any* extension API.** Do not
  "fix" Firefox `about:` bookmarks to open in a tab; it cannot be done, and it has been attempted.
- **Do not rewrite the drag-reorder as native HTML5 drag-and-drop.** It was tried twice and failed
  silently both times. The pointer-based implementation is deliberate.
- **Tag suggestions are the union of tags across all sources**, not per-source.
- **Deletions are invisible to `modified_since`**, so incremental sync cannot see them — that is
  why a separate full sync exists, and why its interval is its own setting.
- **Scheduling is deliberately not "on every force"** — a manual sync must not reschedule the
  automatic one.
- **`unlimitedStorage` is a *required* permission on Chrome**, which rejects it as optional.
- Webpack is CJS under ESM ts-node, so **`DefinePlugin` needs a default import**.

## Code style

TypeScript throughout; pure logic lives in `shared/` and is unit-tested, with browser-specific
access behind `shared/browser.ts`. Keep that boundary — it is what makes the tests possible.
