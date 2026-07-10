import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookmarksToMap,
  bookmarkMapToArray,
  mergeIntoMap,
  computeFolderMembership,
  latestN,
  matchesNode,
  matchWeight,
  sortForDisplay,
  safeFolderBookmarks,
} from "../shared/bookmarks";
import type { Bookmark, Folder, RuleGroup } from "../shared/types";
import { STATIC_BOOKMARKS, STATIC_FOLDERS } from "../shared/data/static";
import { browserBase } from "../shared/browserBase";

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

test("browser_base condition matches the running build's base, not the other one", () => {
  const b = bm("a");
  const other = browserBase === "firefox" ? "chromium" : "firefox";
  assert.equal(matchesNode(b, { match: "all", conditions: [{ type: "browser_base", value: browserBase }] }), true);
  assert.equal(matchesNode(b, { match: "all", conditions: [{ type: "browser_base", value: other }] }), false);
});

test("nested tag+browser_base rules select only this browser's tagged bookmarks", () => {
  const map = bookmarksToMap([
    bm("ff", { tag_names: ["browser", "firefox"] }),
    bm("cr", { tag_names: ["browser", "chromium"] }),
    bm("other", { tag_names: ["firefox"] }), // firefox-tagged but not a browser tool
  ]);
  // Mirror the static "Browser tools" folder:
  // all( tag browser, any( all(base=ff, tag ff), all(base=cr, tag cr) ) ).
  const rules: RuleGroup = {
    match: "all",
    conditions: [
      { type: "tag", value: "browser" },
      {
        match: "any",
        conditions: [
          { match: "all", conditions: [{ type: "browser_base", value: "firefox" }, { type: "tag", value: "firefox" }] },
          { match: "all", conditions: [{ type: "browser_base", value: "chromium" }, { type: "tag", value: "chromium" }] },
        ],
      },
    ],
  };
  const [f] = computeFolderMembership(map, [folder({ rules })]);
  const expected = browserBase === "firefox" ? ["ff"] : ["cr"];
  assert.deepEqual(f.bookmark_ids, expected); // "other" excluded — lacks the browser tag
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

// ---- matchWeight -------------------------------------------------------------

test("matchWeight: leaf contributes its weight only when matched", () => {
  const cond = { type: "tag" as const, value: "dev", weight: 5 };
  assert.equal(matchWeight(bm("a", { tag_names: ["dev"] }), cond), 5);
  assert.equal(matchWeight(bm("b", { tag_names: ["news"] }), cond), 0);
});

test("matchWeight: unweighted leaf defaults to 0", () => {
  const cond = { type: "tag" as const, value: "dev" };
  assert.equal(matchWeight(bm("a", { tag_names: ["dev"] }), cond), 0);
});

test("matchWeight: 'any' group takes MAX of matched children, not sum", () => {
  const rules: RuleGroup = {
    match: "any",
    conditions: [
      { type: "tag", value: "low", weight: 1 },
      { type: "tag", value: "high", weight: 10 },
      { type: "tag", value: "mid", weight: 5 },
    ],
  };
  // matches both "high" (10) and "mid" (5) -> max, not 15
  assert.equal(matchWeight(bm("a", { tag_names: ["high", "mid"] }), rules), 10);
  assert.equal(matchWeight(bm("b", { tag_names: ["low"] }), rules), 1);
  assert.equal(matchWeight(bm("c", { tag_names: ["nope"] }), rules), 0);
});

test("matchWeight: 'all' group sums children's weights", () => {
  const rules: RuleGroup = {
    match: "all",
    conditions: [
      { type: "tag", value: "dev", weight: 3 },
      { type: "tag", value: "rust", weight: 4 },
    ],
  };
  assert.equal(matchWeight(bm("a", { tag_names: ["dev", "rust"] }), rules), 7);
});

test("matchWeight: 'none' group always contributes 0", () => {
  const rules: RuleGroup = {
    match: "none",
    conditions: [{ type: "tag", value: "archived", weight: 99 }],
  };
  assert.equal(matchWeight(bm("a"), rules), 0);
});

test("matchWeight: nested composition — all[any[w1,w5], all[w2,w3]]", () => {
  const rules: RuleGroup = {
    match: "all",
    conditions: [
      {
        match: "any",
        conditions: [
          { type: "tag", value: "low", weight: 1 },
          { type: "tag", value: "high", weight: 5 },
        ],
      },
      {
        match: "all",
        conditions: [
          { type: "tag", value: "req1", weight: 2 },
          { type: "tag", value: "req2", weight: 3 },
        ],
      },
    ],
  };
  const b = bm("a", { tag_names: ["high", "req1", "req2"] });
  assert.equal(matchWeight(b, rules), 5 + (2 + 3));
});

test("matchWeight: a folder with no weights configured scores 0 for everyone (regression)", () => {
  const rules: RuleGroup = {
    match: "any",
    conditions: [{ type: "tag", value: "dev" }, { type: "tag", value: "news" }],
  };
  assert.equal(matchWeight(bm("a", { tag_names: ["dev"] }), rules), 0);
  assert.equal(matchWeight(bm("b", { tag_names: ["news"] }), rules), 0);
});

// ---- sortForDisplay -----------------------------------------------------------

test("sortForDisplay: weight is primary and descending", () => {
  const rules: RuleGroup = {
    match: "any",
    conditions: [
      { type: "tag", value: "low", weight: 1 },
      { type: "tag", value: "high", weight: 10 },
    ],
  };
  const list = [bm("a", { tag_names: ["low"] }), bm("b", { tag_names: ["high"] })];
  const result = sortForDisplay(list, folder({ rules }));
  assert.deepEqual(result.map((b) => b.id), ["b", "a"]);
});

test("sortForDisplay: sort 'added' orders by date desc, undated last", () => {
  const list = [
    bm("old", { date: "2026-01-01T00:00:00Z" }),
    bm("undated"),
    bm("new", { date: "2026-07-01T00:00:00Z" }),
  ];
  const result = sortForDisplay(list, folder({ sort: "added" }));
  assert.deepEqual(result.map((b) => b.id), ["new", "old", "undated"]);
});

test("sortForDisplay: sort 'modified' prefers dateModified, falls back to date", () => {
  const list = [
    bm("modified-recent", { date: "2026-01-01T00:00:00Z", dateModified: "2026-07-01T00:00:00Z" }),
    bm("added-only", { date: "2026-06-01T00:00:00Z" }), // no dateModified: falls back to date
    bm("modified-old", { date: "2026-01-01T00:00:00Z", dateModified: "2026-02-01T00:00:00Z" }),
  ];
  const result = sortForDisplay(list, folder({ sort: "modified" }));
  assert.deepEqual(result.map((b) => b.id), ["modified-recent", "added-only", "modified-old"]);
});

test("sortForDisplay: sort 'alphabetical' is case-insensitive", () => {
  const list = [bm("a", { title: "Banana" }), bm("b", { title: "apple" })];
  const result = sortForDisplay(list, folder({ sort: "alphabetical" }));
  assert.deepEqual(result.map((b) => b.id), ["b", "a"]);
});

test("sortForDisplay: unset sort + no weights preserves original order (regression)", () => {
  const rules: RuleGroup = { match: "any", conditions: [{ type: "tag", value: "dev" }] };
  const list = [bm("c", { tag_names: ["dev"] }), bm("a", { tag_names: ["dev"] }), bm("b", { tag_names: ["dev"] })];
  const result = sortForDisplay(list, folder({ rules }));
  assert.deepEqual(result.map((b) => b.id), ["c", "a", "b"]);
});

test("computeFolderMembership: limit (selection) + weight + sort (display) compose correctly", () => {
  const map = bookmarksToMap([
    bm("a", { tag_names: ["high"], title: "Zebra", date: "2026-01-01T00:00:00Z" }),
    bm("b", { tag_names: ["low"], title: "Apple", date: "2026-02-01T00:00:00Z" }),
    bm("c", { tag_names: ["low"], title: "Mango", date: "2026-03-01T00:00:00Z" }),
    bm("d", { tag_names: ["low"], title: "Banana", date: "2010-01-01T00:00:00Z" }), // oldest, excluded by limit
  ]);
  const rules: RuleGroup = {
    match: "any",
    conditions: [
      { type: "tag", value: "high", weight: 10 },
      { type: "tag", value: "low", weight: 1 },
    ],
  };
  const [result] = computeFolderMembership(map, [
    folder({ rules, limit: 3, sort: "alphabetical" }),
  ]);
  // limit=3 selects the 3 newest by date (a, c, b — "d" excluded), then display
  // orders by weight desc (a=10 first), tiebreak alphabetical among weight-1 ties (b, c).
  assert.deepEqual(result.bookmark_ids, ["a", "b", "c"]);
});
