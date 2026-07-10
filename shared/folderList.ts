import { renderFavicon } from "./favicon";
import { isAllowedBookmarkUrl, isPrivilegedNavUrl } from "./url";
import { safeFolderBookmarks } from "./bookmarks";
import type { Bookmark, BookmarkMap, Folder } from "./types";

// Shared folder/bookmark list rendering for the popup, sidebar and new-tab
// surfaces. The markup is identical everywhere; only how a click opens a
// bookmark differs, so that's injected via callbacks.

export interface BookmarkItemOptions {
  faviconSize: number;
  /** Left-click handler. Omit for native anchor navigation in a new tab (new-tab page). */
  onOpen?: (bookmark: Bookmark) => void;
  /** Opens this bookmark in a background tab without navigating/closing the current view. */
  onOpenBackground?: (bookmark: Bookmark) => void;
  /**
   * Handles a privileged-scheme (about:/chrome://) bookmark, which a plain anchor click
   * can't navigate to — the callback decides how (chrome:// → tabs.create; Firefox about:
   * → copy-to-clipboard fallback). Used by the new-tab surface, which has no `onOpen` and
   * keeps native anchors for normal links. Ignored when `onOpen` is set — that handler
   * already intercepts every click.
   */
  onOpenPrivileged?: (bookmark: Bookmark) => void;
}

export function renderBookmarkItem(bookmark: Bookmark, opts: BookmarkItemOptions): HTMLElement {
  const li = document.createElement("li");
  const a = document.createElement("a");

  // Defensive: only link out to safe schemes. A `javascript:` URL clicked in a
  // privileged extension page would run script in that context, so a bad
  // bookmark is neutered.
  const safe = isAllowedBookmarkUrl(bookmark.url);
  if (safe) {
    a.href = bookmark.url;
    if (!opts.onOpen) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  } else {
    a.href = "#";
    a.title = "Blocked: unsupported link type";
  }

  // A browser-internal URL (about:/chrome://) can't be opened by a native anchor, so
  // intercept it even when there's no `onOpen` (the new-tab case) as long as a handler
  // is supplied. Normal links keep their native anchor when `onOpen` is absent.
  const privileged = safe && !opts.onOpen && !!opts.onOpenPrivileged && isPrivilegedNavUrl(bookmark.url);

  if (opts.onOpen || privileged || !safe) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (!safe) return;
      if (opts.onOpen) opts.onOpen(bookmark);
      else if (privileged) opts.onOpenPrivileged!(bookmark);
    });
  }

  const span = document.createElement("span");
  span.textContent = bookmark.title;

  a.appendChild(renderFavicon(bookmark, opts.faviconSize));
  a.appendChild(span);
  li.appendChild(a);

  // Explicit affordance for opening in a background tab — middle-click covers
  // this for desktop mouse users, but has no equivalent on trackpads or touch.
  if (opts.onOpenBackground && safe) {
    const bgBtn = document.createElement("button");
    bgBtn.type = "button";
    bgBtn.className = "open-bg-btn";
    bgBtn.title = "Open in background tab";
    bgBtn.setAttribute("aria-label", `Open ${bookmark.title} in a background tab`);
    bgBtn.textContent = "⇱";
    bgBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      opts.onOpenBackground!(bookmark);
    });
    li.appendChild(bgBtn);
  }

  return li;
}

export interface FolderDetailsOptions extends BookmarkItemOptions {
  /** Middle-click handler for the folder summary; receives the folder's safe bookmarks. */
  onOpenAll?: (bookmarks: Bookmark[]) => void;
}

export function renderFolderDetails(
  folder: Folder,
  bookmarkMap: BookmarkMap,
  opts: FolderDetailsOptions,
): HTMLElement {
  const details = document.createElement("details");
  details.open = true;

  const summary = document.createElement("summary");
  const nameSpan = document.createElement("span");
  nameSpan.className = "folder-name";
  nameSpan.textContent = folder.name;
  summary.appendChild(nameSpan);

  if (opts.onOpenAll) {
    // Explicit, always-reachable affordance — middle-click below still works
    // as a bonus shortcut for desktop mouse users, but doesn't exist on
    // trackpads or touch.
    const openAllBtn = document.createElement("button");
    openAllBtn.type = "button";
    openAllBtn.className = "open-all-btn";
    openAllBtn.title = "Open all in background tabs";
    openAllBtn.setAttribute("aria-label", `Open all bookmarks in ${folder.name}`);
    openAllBtn.textContent = "⇱";
    openAllBtn.addEventListener("click", (e) => {
      // A click on a child of <summary> otherwise triggers the browser's
      // native <details> toggle — stop that before invoking the callback.
      e.preventDefault();
      e.stopPropagation();
      opts.onOpenAll!(safeFolderBookmarks(folder, bookmarkMap));
    });
    summary.appendChild(openAllBtn);

    summary.addEventListener("mousedown", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      opts.onOpenAll!(safeFolderBookmarks(folder, bookmarkMap));
    });
  }
  details.appendChild(summary);

  const ul = document.createElement("ul");
  for (const id of folder.bookmark_ids) {
    const bookmark = bookmarkMap[id];
    if (bookmark) ul.appendChild(renderBookmarkItem(bookmark, opts));
  }
  details.appendChild(ul);

  return details;
}
