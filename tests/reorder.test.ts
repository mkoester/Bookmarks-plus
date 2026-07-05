import { test } from "node:test";
import assert from "node:assert/strict";
import { insertionIndexForY } from "../shared/reorder";

test("insertionIndexForY: empty list is always index 0", () => {
  assert.equal(insertionIndexForY(50, []), 0);
});

test("insertionIndexForY: above all rows inserts at the top", () => {
  assert.equal(insertionIndexForY(5, [10, 20, 30]), 0);
});

test("insertionIndexForY: below all rows inserts at the end", () => {
  assert.equal(insertionIndexForY(100, [10, 20, 30]), 3);
});

test("insertionIndexForY: between rows inserts before the next one", () => {
  assert.equal(insertionIndexForY(15, [10, 20, 30]), 1);
  assert.equal(insertionIndexForY(25, [10, 20, 30]), 2);
});

test("insertionIndexForY: exactly at a midpoint inserts before that row", () => {
  assert.equal(insertionIndexForY(20, [10, 20, 30]), 1);
});
