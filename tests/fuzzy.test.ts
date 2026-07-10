import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyFilterTags, highlightRuns, type TagCount } from "../shared/fuzzy";

const tags: TagCount[] = [
  { tag: "development", count: 12 },
  { tag: "devops", count: 4 },
  { tag: "web-dev", count: 2 },
  { tag: "design", count: 7 },
  { tag: "fediverse", count: 9 },
];

function tagsOf(rows: TagCount[]): string[] {
  return rows.map((r) => r.tag);
}

test("empty query returns the top tags by count (desc)", () => {
  const result = fuzzyFilterTags("", tags, 3);
  assert.deepEqual(tagsOf(result), ["development", "fediverse", "design"]);
});

test("empty query respects the limit", () => {
  assert.equal(fuzzyFilterTags("", tags, 2).length, 2);
});

test("whitespace-only query is treated as empty", () => {
  assert.deepEqual(tagsOf(fuzzyFilterTags("   ", tags, 1)), ["development"]);
});

test("prefix query surfaces the matching tags", () => {
  const result = tagsOf(fuzzyFilterTags("dev", tags));
  assert.ok(result.includes("development"));
  assert.ok(result.includes("devops"));
  assert.ok(result.includes("web-dev"));
  assert.ok(!result.includes("fediverse"));
});

test("subsequence (non-contiguous) query still matches", () => {
  // f-d-v-r-s appears in order inside "fediverse"
  assert.ok(tagsOf(fuzzyFilterTags("fdvrs", tags)).includes("fediverse"));
});

test("matching is case-insensitive", () => {
  assert.deepEqual(fuzzyFilterTags("DEV", tags), fuzzyFilterTags("dev", tags));
});

test("a stronger match ranks above a weaker one", () => {
  // "devops" starts with the query; "web-dev" only contains it later.
  const result = tagsOf(fuzzyFilterTags("devo", tags));
  assert.equal(result[0], "devops");
});

test("count breaks ties on otherwise equal matches", () => {
  const ties: TagCount[] = [
    { tag: "aa", count: 1 },
    { tag: "ab", count: 50 },
  ];
  // Both are equally good prefix matches for "a"; the higher count wins.
  assert.equal(tagsOf(fuzzyFilterTags("a", ties))[0], "ab");
});

test("no match returns an empty list", () => {
  assert.deepEqual(fuzzyFilterTags("zzzzz", tags), []);
});

test("the limit caps the number of results", () => {
  const many: TagCount[] = Array.from({ length: 20 }, (_, i) => ({
    tag: `tag${i}`,
    count: i,
  }));
  assert.equal(fuzzyFilterTags("tag", many, 5).length, 5);
});

test("matches carry the matched character positions", () => {
  const result = fuzzyFilterTags("dev", [{ tag: "development", count: 1 }]);
  assert.deepEqual([...result[0].matchedIndexes], [0, 1, 2]);
});

test("the top-by-count fallback has no matched indexes", () => {
  const result = fuzzyFilterTags("", tags, 1);
  assert.deepEqual([...result[0].matchedIndexes], []);
});

test("highlightRuns splits a contiguous prefix match", () => {
  assert.deepEqual(highlightRuns("design", [0, 1]), [
    { text: "de", matched: true },
    { text: "sign", matched: false },
  ]);
});

test("highlightRuns handles scattered (non-contiguous) matches", () => {
  // "de" against "fediverse" matches 'd' at 2 and 'e' at 5.
  assert.deepEqual(highlightRuns("fediverse", [2, 5]), [
    { text: "fe", matched: false },
    { text: "d", matched: true },
    { text: "iv", matched: false },
    { text: "e", matched: true },
    { text: "rse", matched: false },
  ]);
});

test("highlightRuns with no matches is a single unmatched run", () => {
  assert.deepEqual(highlightRuns("tag", []), [{ text: "tag", matched: false }]);
});

test("highlightRuns ignores out-of-range indexes", () => {
  assert.deepEqual(highlightRuns("ab", [0, 9]), [
    { text: "a", matched: true },
    { text: "b", matched: false },
  ]);
});
