import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKind } from "../shared/buildInfo";

test("buildKind: clean store-safe versions are release builds", () => {
  assert.equal(buildKind("1.1.8"), "release");
  assert.equal(buildKind("2.0.0"), "release");
  assert.equal(buildKind("10.20.30"), "release");
});

test("buildKind: a clean off-main build (commit hash, no SNAPSHOT) is a branch build", () => {
  assert.equal(buildKind("1.1.8-23f44fd"), "branch");
});

test("buildKind: an uncommitted tree (-SNAPSHOT) is a dirty build", () => {
  assert.equal(buildKind("1.1.8-SNAPSHOT"), "dirty"); // dirty on main
  assert.equal(buildKind("1.1.8-23f44fd-SNAPSHOT"), "dirty"); // dirty off main
});

test("buildKind: a missing version is a release build (harness / no manifest)", () => {
  assert.equal(buildKind(undefined), "release");
});
