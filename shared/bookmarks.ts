import type {
  Bookmark,
  BookmarkMap,
  Folder,
  RuleCondition,
  RuleNode,
} from "./types";
import { isRuleGroup } from "./types";
import { isAllowedBookmarkUrl } from "./url";

// ---- Map conversion ---------------------------------------------------------

export function bookmarksToMap(bookmarks: Bookmark[]): BookmarkMap {
  return Object.fromEntries(bookmarks.map((b) => [b.id, b]));
}

export function bookmarkMapToArray(map: BookmarkMap): Bookmark[] {
  return Object.values(map);
}

// ---- Incremental sync merge -------------------------------------------------

export function mergeIntoMap(existing: BookmarkMap, updated: Bookmark[]): BookmarkMap {
  const result = { ...existing };
  for (const b of updated) {
    result[b.id] = b;
  }
  return result;
}

/** The folder's bookmarks that exist in the map and have an allowed URL scheme. */
export function safeFolderBookmarks(folder: Folder, bookmarkMap: BookmarkMap): Bookmark[] {
  return folder.bookmark_ids
    .map((id) => bookmarkMap[id])
    .filter((b): b is Bookmark => b != null && isAllowedBookmarkUrl(b.url));
}

// ---- Folder rule evaluation -------------------------------------------------

function matchesCondition(bookmark: Bookmark, condition: RuleCondition): boolean {
  switch (condition.type) {
    case "tag":
      return bookmark.tag_names.includes(condition.value);
    case "url_contains":
      return bookmark.url.toLowerCase().includes(condition.value.toLowerCase());
    case "title_contains":
      return bookmark.title.toLowerCase().includes(condition.value.toLowerCase());
    case "provider":
      // value is a provider config id; bookmark ids are "${providerConfigId}:${rawId}"
      return bookmark.id.startsWith(`${condition.value}:`);
    default:
      return false;
  }
}

// Group semantics (uniform at every nesting level):
//
//   match  | empty conditions | non-empty conditions
//   -------|------------------|---------------------------------
//   all    | false            | every child matches (AND)
//   any    | false            | at least one child matches (OR)
//   none   | false            | no child matches (NOT(A OR B ...))
//
// Empty groups never match — deliberately not vacuous truth for "all",
// so a half-built group can never silently match everything.
export function matchesNode(bookmark: Bookmark, node: RuleNode): boolean {
  if (!isRuleGroup(node)) return matchesCondition(bookmark, node);
  if (node.conditions.length === 0) return false;
  switch (node.match) {
    case "all":
      return node.conditions.every((c) => matchesNode(bookmark, c));
    case "any":
      return node.conditions.some((c) => matchesNode(bookmark, c));
    case "none":
      return !node.conditions.some((c) => matchesNode(bookmark, c));
  }
}

function matchesFolder(bookmark: Bookmark, folder: Folder): boolean {
  return matchesNode(bookmark, folder.rules);
}

// The newest n bookmarks by date. Undated bookmarks sort last; ties (and the
// undated tail) keep their input order — for feeds that is the feed's own
// order, which is conventionally newest-first anyway. Also used by the feed
// provider's per-feed maxItems cap.
export function latestN(bookmarks: Bookmark[], n: number): Bookmark[] {
  const timestamp = (b: Bookmark): number => {
    const t = b.date ? Date.parse(b.date) : NaN;
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  return [...bookmarks]
    .sort((a, b) => {
      const ta = timestamp(a);
      const tb = timestamp(b);
      if (tb > ta) return 1;
      if (tb < ta) return -1;
      return 0; // Array.prototype.sort is stable
    })
    .slice(0, n);
}

export function computeFolderMembership(
  bookmarkMap: BookmarkMap,
  folders: Folder[]
): Folder[] {
  const bookmarks = bookmarkMapToArray(bookmarkMap);
  return folders.map((folder) => {
    const matched = bookmarks.filter((b) => matchesFolder(b, folder));
    const chosen =
      folder.limit !== undefined && folder.limit > 0 ? latestN(matched, folder.limit) : matched;
    return { ...folder, bookmark_ids: chosen.map((b) => b.id) };
  });
}
