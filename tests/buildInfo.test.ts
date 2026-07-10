import { test } from "node:test";
import assert from "node:assert/strict";
import { isDevBuild } from "../shared/buildInfo";

test("isDevBuild: clean store-safe versions are release builds", () => {
  assert.equal(isDevBuild("1.1.8"), false);
  assert.equal(isDevBuild("2.0.0"), false);
  assert.equal(isDevBuild("10.20.30"), false);
});

test("isDevBuild: git-decorated versions are dev builds", () => {
  assert.equal(isDevBuild("1.1.8-23f44fd"), true); // other branch
  assert.equal(isDevBuild("1.1.8-SNAPSHOT"), true); // dirty tree
  assert.equal(isDevBuild("1.1.8-23f44fd-SNAPSHOT"), true); // both
});

test("isDevBuild: a missing version is not a dev build (harness / no manifest)", () => {
  assert.equal(isDevBuild(undefined), false);
});
