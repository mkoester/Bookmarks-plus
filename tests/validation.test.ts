import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBookmarks, entryToBookmark } from "../shared/validation";

const valid = { url: "https://example.com", title: "Example" };

test("validateBookmarks accepts a minimal valid array", () => {
  const result = validateBookmarks([valid]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateBookmarks rejects non-arrays and empty arrays", () => {
  assert.equal(validateBookmarks({}).valid, false);
  assert.deepEqual(validateBookmarks({}).errors, ["root must be an array"]);
  assert.deepEqual(validateBookmarks([]).errors, ["array must not be empty"]);
});

test("validateBookmarks rejects entries with bad url/title", () => {
  const result = validateBookmarks([
    { url: "javascript:alert(1)", title: "xss" },
    { url: "https://ok.example", title: "" },
    "not an object",
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /bookmarks\[0\].*url/);
  assert.match(result.errors[1], /bookmarks\[1\].*title/);
  assert.match(result.errors[2], /bookmarks\[2\].*object/);
});

test("validateBookmarks checks optional tag_names and favicon_url", () => {
  const result = validateBookmarks([
    { ...valid, tag_names: ["ok", ""] },
    { ...valid, favicon_url: "javascript:alert(1)" },
  ]);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /tag_names/);
  assert.match(result.errors[1], /favicon_url/);
});

test("entryToBookmark namespaces the id under the provider", () => {
  const bookmark = entryToBookmark({ ...valid, id: 42 }, 0, "linkding");
  assert.equal(bookmark.id, "linkding:42");
  assert.equal(bookmark.url, valid.url);
  assert.deepEqual(bookmark.tag_names, []);
});

test("entryToBookmark falls back to the array index without an id", () => {
  const bookmark = entryToBookmark({ ...valid }, 7, "json");
  assert.equal(bookmark.id, "json:7");
});

test("entryToBookmark keeps favicon_url only when it is a string", () => {
  const withIcon = entryToBookmark({ ...valid, favicon_url: "https://x/i.png" }, 0, "p");
  assert.equal(withIcon.favicon_url, "https://x/i.png");
  const without = entryToBookmark({ ...valid }, 0, "p");
  assert.equal("favicon_url" in without, false);
});
