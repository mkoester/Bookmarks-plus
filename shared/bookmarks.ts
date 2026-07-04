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

export function computeFolderMembership(
  bookmarkMap: BookmarkMap,
  folders: Folder[]
): Folder[] {
  const bookmarks = bookmarkMapToArray(bookmarkMap);
  return folders.map((folder) => ({
    ...folder,
    bookmark_ids: bookmarks
      .filter((b) => matchesFolder(b, folder))
      .map((b) => b.id),
  }));
}
