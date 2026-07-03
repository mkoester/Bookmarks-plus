import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookmarksToMap,
  bookmarkMapToArray,
  mergeIntoMap,
  computeFolderMembership,
  safeFolderBookmarks,
} from "../shared/bookmarks";
import type { Bookmark, Folder } from "../shared/types";

function bm(id: string, overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Bookmark ${id}`,
    tag_names: [],
    ...overrides,
  };
}

function folder(overrides: Partial<Folder>): Folder {
  return {
    id: "f1",
    name: "Folder",
    rules: { match: "any", conditions: [] },
    bookmark_ids: [],
    ...overrides,
  };
}

test("bookmarksToMap / bookmarkMapToArray round-trip", () => {
  const list = [bm("a"), bm("b")];
  const map = bookmarksToMap(list);
  assert.deepEqual(map["a"], list[0]);
  assert.deepEqual(bookmarkMapToArray(map), list);
});

test("mergeIntoMap overwrites by id and keeps the rest", () => {
  const existing = bookmarksToMap([bm("a"), bm("b")]);
  const merged = mergeIntoMap(existing, [bm("b", { title: "updated" }), bm("c")]);
  assert.equal(Object.keys(merged).length, 3);
  assert.equal(merged["b"].title, "updated");
  assert.equal(existing["b"].title, "Bookmark b"); // input not mutated
});

test("computeFolderMembership matches tag conditions", () => {
  const map = bookmarksToMap([
    bm("a", { tag_names: ["dev"] }),
    bm("b", { tag_names: ["news"] }),
  ]);
  const folders = computeFolderMembership(map, [
    folder({ rules: { match: "any", conditions: [{ type: "tag", value: "dev" }] } }),
  ]);
  assert.deepEqual(folders[0].bookmark_ids, ["a"]);
});

test("computeFolderMembership: 'all' requires every condition, empty matches nothing", () => {
  const map = bookmarksToMap([
    bm("a", { tag_names: ["dev"], title: "Weekly news" }),
    bm("b", { tag_names: ["dev"] }),
  ]);
  const [allFolder, emptyFolder] = computeFolderMembership(map, [
    folder({
      rules: {
        match: "all",
        conditions: [
          { type: "tag", value: "dev" },
          { type: "title_contains", value: "NEWS" }, // case-insensitive
        ],
      },
    }),
    folder({ rules: { match: "any", conditions: [] } }),
  ]);
  assert.deepEqual(allFolder.bookmark_ids, ["a"]);
  assert.deepEqual(emptyFolder.bookmark_ids, []);
});

test("computeFolderMembership matches url_contains case-insensitively", () => {
  const map = bookmarksToMap([bm("a", { url: "https://GitHub.com/mkoester" })]);
  const folders = computeFolderMembership(map, [
    folder({ rules: { match: "any", conditions: [{ type: "url_contains", value: "github" }] } }),
  ]);
  assert.deepEqual(folders[0].bookmark_ids, ["a"]);
});

test("safeFolderBookmarks drops missing ids and unsafe URLs", () => {
  const map = bookmarksToMap([
    bm("a"),
    bm("b", { url: "javascript:alert(1)" }),
  ]);
  const result = safeFolderBookmarks(folder({ bookmark_ids: ["a", "b", "gone"] }), map);
  assert.deepEqual(result.map((b) => b.id), ["a"]);
});
