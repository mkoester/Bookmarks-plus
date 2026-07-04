import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookmarksToMap,
  bookmarkMapToArray,
  mergeIntoMap,
  computeFolderMembership,
  latestN,
  matchesNode,
  safeFolderBookmarks,
} from "../shared/bookmarks";
import type { Bookmark, Folder, RuleGroup } from "../shared/types";
import { STATIC_BOOKMARKS, STATIC_FOLDERS } from "../shared/data/static";

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

test("matchesNode: A AND (B OR C)", () => {
  const rules: RuleGroup = {
    match: "all",
    conditions: [
      { type: "tag", value: "dev" },
      {
        match: "any",
        conditions: [
          { type: "tag", value: "rust" },
          { type: "url_contains", value: "github" },
        ],
      },
    ],
  };
  assert.equal(matchesNode(bm("a", { tag_names: ["dev", "rust"] }), rules), true);
  assert.equal(matchesNode(bm("b", { tag_names: ["dev"], url: "https://github.com/x" }), rules), true);
  assert.equal(matchesNode(bm("c", { tag_names: ["dev"] }), rules), false); // A alone
  assert.equal(matchesNode(bm("d", { tag_names: ["rust"] }), rules), false); // B without A
});

test("matchesNode: root 'none' matches bookmarks matching no condition", () => {
  const rules: RuleGroup = {
    match: "none",
    conditions: [
      { type: "tag", value: "archived" },
      { type: "title_contains", value: "draft" },
    ],
  };
  assert.equal(matchesNode(bm("a"), rules), true);
  assert.equal(matchesNode(bm("b", { tag_names: ["archived"] }), rules), false);
  assert.equal(matchesNode(bm("c", { title: "My Draft post" }), rules), false);
});

test("matchesNode: 'none' nested under 'all' (dev AND NOT (archived OR draft))", () => {
  const rules: RuleGroup = {
    match: "all",
    conditions: [
      { type: "tag", value: "dev" },
      {
        match: "none",
        conditions: [
          { type: "tag", value: "archived" },
          { type: "title_contains", value: "draft" },
        ],
      },
    ],
  };
  assert.equal(matchesNode(bm("a", { tag_names: ["dev"] }), rules), true);
  assert.equal(matchesNode(bm("b", { tag_names: ["dev", "archived"] }), rules), false);
  assert.equal(matchesNode(bm("c", { tag_names: ["dev"], title: "Draft ideas" }), rules), false);
  assert.equal(matchesNode(bm("d", { tag_names: ["news"] }), rules), false);
});

test("matchesNode: empty groups never match, at any level", () => {
  const b = bm("a", { tag_names: ["dev"] });
  // Empty roots in every mode
  assert.equal(matchesNode(b, { match: "all", conditions: [] }), false);
  assert.equal(matchesNode(b, { match: "any", conditions: [] }), false);
  assert.equal(matchesNode(b, { match: "none", conditions: [] }), false);
  // 'any' root still matches via the leaf despite an empty sibling group
  const anyWithEmpty: RuleGroup = {
    match: "any",
    conditions: [{ match: "all", conditions: [] }, { type: "tag", value: "dev" }],
  };
  assert.equal(matchesNode(b, anyWithEmpty), true);
  // 'all' root containing an empty group matches nothing
  const allWithEmpty: RuleGroup = {
    match: "all",
    conditions: [{ type: "tag", value: "dev" }, { match: "any", conditions: [] }],
  };
  assert.equal(matchesNode(b, allWithEmpty), false);
});

test("matchesNode: deep nesting evaluates correctly", () => {
  // dev AND (rust OR (news AND NOT weekly))
  const rules: RuleGroup = {
    match: "all",
    conditions: [
      { type: "tag", value: "dev" },
      {
        match: "any",
        conditions: [
          { type: "tag", value: "rust" },
          {
            match: "all",
            conditions: [
              { type: "tag", value: "news" },
              { match: "none", conditions: [{ type: "title_contains", value: "weekly" }] },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(matchesNode(bm("a", { tag_names: ["dev", "news"] }), rules), true);
  assert.equal(matchesNode(bm("b", { tag_names: ["dev", "news"], title: "Weekly digest" }), rules), false);
  assert.equal(matchesNode(bm("c", { tag_names: ["dev", "rust"], title: "Weekly digest" }), rules), true);
});

test("matchesNode: provider condition matches the bookmark id's namespace prefix", () => {
  const rules: RuleGroup = {
    match: "any",
    conditions: [{ type: "provider", value: "linkding-1" }],
  };
  assert.equal(matchesNode(bm("linkding-1:42"), rules), true);
  assert.equal(matchesNode(bm("browser:42"), rules), false);
  // whole-namespace match only — no partial prefixes
  assert.equal(matchesNode(bm("linkding-10:42"), rules), false);
});

test("matchesNode: provider combined with none picks untagged leftovers per source", () => {
  // all bookmarks from one provider that no tag rule caught
  const rules: RuleGroup = {
    match: "all",
    conditions: [
      { type: "provider", value: "feed-1" },
      { match: "none", conditions: [{ type: "tag", value: "dev" }] },
    ],
  };
  assert.equal(matchesNode(bm("feed-1:1"), rules), true);
  assert.equal(matchesNode(bm("feed-1:2", { tag_names: ["dev"] }), rules), false);
  assert.equal(matchesNode(bm("linkding-1:1"), rules), false);
});

test("computeFolderMembership: old flat-format rules keep working (regression)", () => {
  // Shape exactly as persisted by pre-nesting versions.
  const map = bookmarksToMap([
    bm("a", { tag_names: ["dev"] }),
    bm("b", { tag_names: ["news"] }),
  ]);
  const flat = folder({
    rules: { match: "any", conditions: [{ type: "tag", value: "dev" }] },
  });
  const [result] = computeFolderMembership(map, [flat]);
  assert.deepEqual(result.bookmark_ids, ["a"]);
});

test("static demo folders: nested rules match the expected demo bookmarks", () => {
  const map = bookmarksToMap(STATIC_BOOKMARKS);
  const byName = Object.fromEntries(
    computeFolderMembership(map, STATIC_FOLDERS).map((f) => [f.name, f.bookmark_ids])
  );
  // community AND NOT (social-media OR crowdsourcing): Lemmy (11), Tildes (12),
  // Wikipedia (1), and OpenStreetMap (5) are excluded.
  assert.deepEqual(
    byName["Community (not social media nor crowdsourcing)"],
    ["6", "8", "17"]
  );
  // knowledge AND (education OR opensource): Khan Academy + Creative Commons.
  assert.deepEqual(byName["Open knowledge"], ["7", "8"]);
});

test("latestN: newest first by date, undated keep input order at the end", () => {
  const list = [
    bm("old", { date: "2026-01-01T00:00:00Z" }),
    bm("undated1"),
    bm("new", { date: "2026-07-01T00:00:00Z" }),
    bm("undated2"),
    bm("mid", { date: "2026-03-01T00:00:00Z" }),
  ];
  assert.deepEqual(latestN(list, 3).map((b) => b.id), ["new", "mid", "old"]);
  // n beyond dated items: undated fill up in input order
  assert.deepEqual(latestN(list, 5).map((b) => b.id), ["new", "mid", "old", "undated1", "undated2"]);
  // input not mutated
  assert.equal(list[0].id, "old");
});

test("computeFolderMembership: folder limit keeps only the newest matches", () => {
  const map = bookmarksToMap([
    bm("a", { tag_names: ["dev"], date: "2026-01-01T00:00:00Z" }),
    bm("b", { tag_names: ["dev"], date: "2026-07-01T00:00:00Z" }),
    bm("c", { tag_names: ["dev"] }),
    bm("d", { tag_names: ["news"], date: "2026-08-01T00:00:00Z" }),
  ]);
  const rules = { match: "any" as const, conditions: [{ type: "tag" as const, value: "dev" }] };
  const [limited, unlimited] = computeFolderMembership(map, [
    folder({ rules, limit: 2 }),
    folder({ id: "f2", rules }),
  ]);
  assert.deepEqual(limited.bookmark_ids, ["b", "a"]); // d doesn't match, c is undated
  assert.deepEqual(unlimited.bookmark_ids, ["a", "b", "c"]);
});

test("safeFolderBookmarks drops missing ids and unsafe URLs", () => {
  const map = bookmarksToMap([
    bm("a"),
    bm("b", { url: "javascript:alert(1)" }),
  ]);
  const result = safeFolderBookmarks(folder({ bookmark_ids: ["a", "b", "gone"] }), map);
  assert.deepEqual(result.map((b) => b.id), ["a"]);
});
