import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateBookmarks,
  entryToBookmark,
  parseRuleGroup,
  parseFolders,
} from "../shared/validation";

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

// ---- parseRuleGroup ----------------------------------------------------------

test("parseRuleGroup accepts the old flat format", () => {
  const result = parseRuleGroup({
    match: "any",
    conditions: [{ type: "tag", value: "dev" }],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.group, {
    match: "any",
    conditions: [{ type: "tag", value: "dev" }],
  });
});

test("parseRuleGroup accepts nested groups and 'none'", () => {
  const rules = {
    match: "all",
    conditions: [
      { type: "tag", value: "dev" },
      {
        match: "none",
        conditions: [{ type: "title_contains", value: "draft" }],
      },
    ],
  };
  const result = parseRuleGroup(rules);
  assert.equal(result.valid, true);
  assert.deepEqual(result.group, rules);
});

test("parseRuleGroup accepts provider conditions", () => {
  const rules = {
    match: "any",
    conditions: [{ type: "provider", value: "linkding-1" }],
  };
  const result = parseRuleGroup(rules);
  assert.equal(result.valid, true);
  assert.deepEqual(result.group, rules);
});

test("parseRuleGroup accepts empty conditions arrays", () => {
  const result = parseRuleGroup({ match: "any", conditions: [] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.group, { match: "any", conditions: [] });
});

test("parseRuleGroup rejects bad match, type, and value", () => {
  const bad = parseRuleGroup({
    match: "sum",
    conditions: [
      { type: "tags", value: "dev" },
      { type: "tag", value: "" },
      { type: "tag", value: 5 },
    ],
  });
  assert.equal(bad.valid, false);
  assert.equal(bad.group, null);
  assert.match(bad.errors[0], /rules: match must be one of all, any, none/);
  assert.match(bad.errors[1], /rules\.conditions\[0\]: type/);
  assert.match(bad.errors[2], /rules\.conditions\[1\]: value/);
  assert.match(bad.errors[3], /rules\.conditions\[2\]: value/);
});

test("parseRuleGroup rejects hybrid and unclassifiable nodes", () => {
  const hybrid = parseRuleGroup({
    match: "any",
    conditions: [{ type: "tag", value: "x", conditions: [] }],
  });
  assert.equal(hybrid.valid, false);
  assert.match(hybrid.errors[0], /conditions\[0\].*condition.*or.*group/);

  const neither = parseRuleGroup({ match: "any", conditions: [{ foo: 1 }] });
  assert.equal(neither.valid, false);

  const notObject = parseRuleGroup("rules");
  assert.equal(notObject.valid, false);
  assert.match(notObject.errors[0], /must be an object/);
});

test("parseRuleGroup rejects non-array conditions and bare root conditions", () => {
  const badConditions = parseRuleGroup({ match: "any", conditions: "nope" });
  assert.equal(badConditions.valid, false);
  assert.match(badConditions.errors[0], /conditions must be an array/);

  const bareCondition = parseRuleGroup({ type: "tag", value: "dev" });
  assert.equal(bareCondition.valid, false);
  assert.match(bareCondition.errors[0], /root must be a group/);
});

test("parseRuleGroup reports nested error paths", () => {
  const result = parseRuleGroup({
    match: "all",
    conditions: [
      { type: "tag", value: "ok" },
      { match: "any", conditions: [{ type: "nope", value: "x" }] },
    ],
  });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /rules\.conditions\[1\]\.conditions\[0\]/);
});

// ---- parseFolders --------------------------------------------------------------

const validFolder = {
  id: "f1",
  name: "Dev",
  rules: { match: "any", conditions: [{ type: "tag", value: "dev" }] },
};

test("parseFolders accepts old flat-format folders", () => {
  const result = parseFolders([validFolder]);
  assert.equal(result.valid, true);
  assert.equal(result.folders.length, 1);
  assert.equal(result.folders[0].id, "f1");
  assert.deepEqual(result.folders[0].bookmark_ids, []);
});

test("parseFolders rejects non-arrays and empty arrays", () => {
  assert.deepEqual(parseFolders({}).errors, ["root must be an array"]);
  assert.deepEqual(parseFolders([]).errors, ["array must not be empty"]);
});

test("parseFolders generates ids when absent and rejects duplicates", () => {
  const noId = parseFolders([{ name: "A", rules: { match: "any", conditions: [] } }]);
  assert.equal(noId.valid, true);
  assert.match(noId.folders[0].id, /^[0-9a-f-]{36}$/);

  const dupes = parseFolders([validFolder, { ...validFolder, name: "Other" }]);
  assert.equal(dupes.valid, false);
  assert.match(dupes.errors[0], /folders\[1\].*duplicate id/);
  assert.equal(dupes.folders.length, 1); // parseable subset keeps the first
});

test("parseFolders requires a non-empty name and valid rules", () => {
  const result = parseFolders([
    { ...validFolder, name: "" },
    { ...validFolder, id: "f2", rules: { match: "bad", conditions: [] } },
    "not an object",
  ]);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /folders\[0\]: name/);
  assert.match(result.errors[1], /folders\[1\]\.rules: match/);
  assert.match(result.errors[2], /folders\[2\]: must be an object/);
  assert.deepEqual(result.folders, []);
});

test("parseFolders keeps sane bookmark_ids and resets garbage to []", () => {
  const result = parseFolders([
    { ...validFolder, bookmark_ids: ["p:1", "p:2"] },
    { ...validFolder, id: "f2", name: "B", bookmark_ids: "junk" },
    { ...validFolder, id: "f3", name: "C", bookmark_ids: [1, 2] },
  ]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.folders[0].bookmark_ids, ["p:1", "p:2"]);
  assert.deepEqual(result.folders[1].bookmark_ids, []);
  assert.deepEqual(result.folders[2].bookmark_ids, []);
});
