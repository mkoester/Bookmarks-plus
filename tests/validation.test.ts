import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateBookmarks,
  entryToBookmark,
  parseJsonFeed,
  parseRuleGroup,
  parseFolders,
  toIsoDate,
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

// ---- parseJsonFeed -------------------------------------------------------------

test("parseJsonFeed maps items to namespaced bookmarks with tags", () => {
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: "A Feed",
    items: [
      {
        id: "https://blog.example/post-1",
        url: "https://blog.example/post-1",
        title: "Post one",
        tags: ["dev", "", 42, "news"],
      },
    ],
  };
  const result = parseJsonFeed(feed, "feed-1", true);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.bookmarks, [
    {
      id: "feed-1:https://blog.example/post-1",
      url: "https://blog.example/post-1",
      title: "Post one",
      tag_names: ["dev", "news"], // non-strings and empties dropped
    },
  ]);
});

test("parseJsonFeed: external_url preference (linkblog pattern)", () => {
  const items = [
    {
      id: "1",
      url: "https://linkblog.example/linked/1",
      external_url: "https://article.example/story",
      title: "Linked",
    },
    { id: "2", url: "https://linkblog.example/own-post", title: "Own" },
  ];
  const prefer = parseJsonFeed({ items }, "p", true);
  assert.equal(prefer.bookmarks[0].url, "https://article.example/story");
  assert.equal(prefer.bookmarks[1].url, "https://linkblog.example/own-post"); // no external_url → own
  const own = parseJsonFeed({ items }, "p", false);
  assert.equal(own.bookmarks[0].url, "https://linkblog.example/linked/1");
});

test("parseJsonFeed: title fallback chain for untitled items", () => {
  const items = [
    { id: "1", url: "https://a.example/1", content_text: "  plain   text post  " },
    { id: "2", url: "https://a.example/2", content_html: "<p>American flag&rsquo;s <b>28</b> stars</p>" },
    { id: "3", url: "https://a.example/3" },
    { id: "4", url: "https://a.example/4", content_text: "x".repeat(100) },
  ];
  const result = parseJsonFeed({ items }, "p", true);
  assert.equal(result.bookmarks[0].title, "plain text post");
  assert.equal(result.bookmarks[1].title, "American flag’s 28 stars");
  assert.equal(result.bookmarks[2].title, "https://a.example/3");
  assert.equal(result.bookmarks[3].title, `${"x".repeat(79)}…`);
});

test("parseJsonFeed skips unusable items but keeps the rest", () => {
  const items = [
    { id: "1", title: "no url at all" },
    { id: "2", url: "javascript:alert(1)", title: "bad scheme" },
    "not an object",
    { id: "4", url: "https://ok.example/", title: "fine" },
  ];
  const result = parseJsonFeed({ items }, "p", true);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 3);
  assert.deepEqual(result.bookmarks.map((b) => b.id), ["p:4"]);
});

test("parseJsonFeed: missing id falls back to the URL; feed favicon applies to items", () => {
  const feed = {
    favicon: "https://blog.example/favicon.png",
    items: [{ url: "https://blog.example/post", title: "Post" }],
  };
  const result = parseJsonFeed(feed, "p", true);
  assert.equal(result.bookmarks[0].id, "p:https://blog.example/post");
  assert.equal(result.bookmarks[0].favicon_url, "https://blog.example/favicon.png");
  // unsafe favicon is ignored
  const unsafe = parseJsonFeed(
    { favicon: "javascript:x", items: [{ url: "https://blog.example/post" }] },
    "p",
    true
  );
  assert.equal("favicon_url" in unsafe.bookmarks[0], false);
});

test("parseJsonFeed rejects documents without an items array", () => {
  for (const bad of [null, "x", 42, [], {}, { items: "nope" }]) {
    const result = parseJsonFeed(bad, "p", true);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /not a JSON Feed/);
    assert.deepEqual(result.bookmarks, []);
  }
});

// ---- toIsoDate / dates ---------------------------------------------------------

test("toIsoDate normalises RFC 3339 and RFC 822, rejects garbage", () => {
  assert.equal(toIsoDate("2026-07-03T14:55:01-05:00"), "2026-07-03T19:55:01.000Z");
  assert.equal(toIsoDate("Thu, 02 Jul 2026 22:30:40 GMT"), "2026-07-02T22:30:40.000Z");
  assert.equal(toIsoDate("not a date"), undefined);
  assert.equal(toIsoDate(""), undefined);
  assert.equal(toIsoDate(42), undefined);
});

test("parseJsonFeed maps date_published (date_modified fallback) to date", () => {
  const feed = {
    items: [
      { url: "https://a.example/1", date_published: "2026-07-03T14:55:01-05:00" },
      { url: "https://a.example/2", date_modified: "2026-07-01T00:00:00Z" },
      { url: "https://a.example/3" },
    ],
  };
  const result = parseJsonFeed(feed, "p", true);
  assert.equal(result.bookmarks[0].date, "2026-07-03T19:55:01.000Z");
  assert.equal(result.bookmarks[1].date, "2026-07-01T00:00:00.000Z");
  assert.equal("date" in result.bookmarks[2], false);
});

test("entryToBookmark keeps a parseable date and drops an invalid one", () => {
  const withDate = entryToBookmark({ ...valid, date: "2026-07-04" }, 0, "p");
  assert.equal(withDate.date, "2026-07-04T00:00:00.000Z");
  const badDate = entryToBookmark({ ...valid, date: "yesterday-ish" }, 0, "p");
  assert.equal("date" in badDate, false);
});

test("validateBookmarks rejects an unparseable date", () => {
  const result = validateBookmarks([{ ...valid, date: "not a date" }]);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /date/);
});

// ---- parseFolders limit ---------------------------------------------------------

test("parseFolders accepts a positive integer limit and rejects other values", () => {
  const ok = parseFolders([{ ...validFolder, limit: 5 }]);
  assert.equal(ok.valid, true);
  assert.equal(ok.folders[0].limit, 5);

  const none = parseFolders([validFolder]);
  assert.equal("limit" in none.folders[0], false);

  for (const bad of [0, -1, 2.5, "5"]) {
    const result = parseFolders([{ ...validFolder, limit: bad }]);
    assert.equal(result.valid, false, `should reject limit ${JSON.stringify(bad)}`);
    assert.match(result.errors[0], /limit must be a positive integer/);
  }
});
