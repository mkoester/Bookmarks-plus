import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FULL_SYNC_MAX_AGE_MS,
  alarmPeriodMinutes,
  applySyncResult,
  effectiveIntervalMinutes,
  isDue,
  maxModifiedCursor,
  mergeSyncErrors,
  needsFullSync,
  providerFingerprint,
  pruneBookmarks,
} from "../shared/sync";
import type {
  Bookmark,
  BookmarkMap,
  LinkdingProviderConfig,
  ProviderSyncState,
  Settings,
} from "../shared/types";

const NOW = Date.parse("2026-07-05T12:00:00Z");

function bm(id: string, extra: Partial<Bookmark> = {}): Bookmark {
  return { id, url: `https://example.com/${id}`, title: id, tag_names: [], ...extra };
}

function state(overrides: Partial<ProviderSyncState> = {}): ProviderSyncState {
  const iso = new Date(NOW).toISOString();
  return {
    lastSyncAt: iso,
    lastAttemptAt: iso,
    lastFullSyncAt: iso,
    fingerprint: "fp",
    ...overrides,
  };
}

function linkdingConfig(overrides: Partial<LinkdingProviderConfig> = {}): LinkdingProviderConfig {
  return {
    id: "ld",
    type: "linkding",
    name: "linkding",
    url: "https://links.example.com",
    token: "secret",
    ...overrides,
  };
}

// ---- effectiveIntervalMinutes / alarmPeriodMinutes ----------------------------

test("effectiveIntervalMinutes: override wins when sane, global otherwise", () => {
  assert.equal(effectiveIntervalMinutes(linkdingConfig({ syncIntervalMinutes: 5 }), 15), 5);
  assert.equal(effectiveIntervalMinutes(linkdingConfig(), 15), 15);
  assert.equal(effectiveIntervalMinutes(linkdingConfig({ syncIntervalMinutes: 0 }), 15), 15);
  // static has no override field at all
  assert.equal(
    effectiveIntervalMinutes({ id: "s", type: "static", name: "static" }, 15),
    15
  );
});

test("alarmPeriodMinutes: minimum of global and overrides, floored at 1", () => {
  const settings: Settings = {
    syncIntervalMinutes: 15,
    theme: "system",
    newTabCloseOnOpenAll: false,
    providers: [
      { id: "s", type: "static", name: "static" },
      linkdingConfig({ syncIntervalMinutes: 5 }),
    ],
  };
  assert.equal(alarmPeriodMinutes(settings), 5);
  settings.providers = [linkdingConfig({ syncIntervalMinutes: 90 })];
  assert.equal(alarmPeriodMinutes(settings), 15); // override longer than global: alarm keeps global pace
  settings.providers = [];
  assert.equal(alarmPeriodMinutes(settings), 15);
});

// ---- isDue --------------------------------------------------------------------

test("isDue: missing or unparseable state is due", () => {
  assert.equal(isDue(undefined, 15, NOW), true);
  assert.equal(isDue(state({ lastAttemptAt: "garbage" }), 15, NOW), true);
});

test("isDue: based on last attempt vs interval", () => {
  const past = new Date(NOW - 16 * 60_000).toISOString();
  const recent = new Date(NOW - 14 * 60_000).toISOString();
  assert.equal(isDue(state({ lastAttemptAt: past }), 15, NOW), true);
  assert.equal(isDue(state({ lastAttemptAt: recent }), 15, NOW), false);
});

// ---- needsFullSync --------------------------------------------------------------

test("needsFullSync: no state, changed fingerprint, or stale/absent full sync", () => {
  assert.equal(needsFullSync(undefined, "fp", NOW), true);
  assert.equal(needsFullSync(state({ fingerprint: "other" }), "fp", NOW), true);
  assert.equal(needsFullSync(state({ lastFullSyncAt: "" }), "fp", NOW), true);
  const old = new Date(NOW - FULL_SYNC_MAX_AGE_MS - 1).toISOString();
  assert.equal(needsFullSync(state({ lastFullSyncAt: old }), "fp", NOW), true);
  assert.equal(needsFullSync(state(), "fp", NOW), false);
});

// ---- providerFingerprint --------------------------------------------------------

test("providerFingerprint: sensitive to sync-relevant fields only", () => {
  const a = providerFingerprint(linkdingConfig());
  assert.equal(a, providerFingerprint(linkdingConfig({ username: "display-only" })));
  assert.notEqual(a, providerFingerprint(linkdingConfig({ url: "https://elsewhere.example" })));
  assert.notEqual(a, providerFingerprint(linkdingConfig({ token: "rotated" })));
});

test("providerFingerprint: feed alias and json hashing", () => {
  const feed = providerFingerprint({
    id: "f", type: "feed", name: "feed", url: "https://x/feed", preferExternalUrl: true,
  });
  const alias = providerFingerprint({
    id: "f", type: "jsonfeed", name: "feed", url: "https://x/feed", preferExternalUrl: true,
  });
  assert.equal(feed, alias); // legacy alias syncs identically
  const j1 = providerFingerprint({ id: "j", type: "json", name: "json", data: "[]" });
  const j2 = providerFingerprint({ id: "j", type: "json", name: "json", data: "[{}]" });
  assert.notEqual(j1, j2);
  assert.ok(!j1.includes("[]")); // hashed, not embedded
});

// ---- applySyncResult ------------------------------------------------------------

const MAP: BookmarkMap = {
  "a:1": bm("a:1"),
  "a:2": bm("a:2"),
  "b:1": bm("b:1"),
};

test("applySyncResult full: replaces only the provider's slice", () => {
  const out = applySyncResult(MAP, "a", { kind: "full", bookmarks: [bm("a:3")] });
  assert.deepEqual(Object.keys(out).sort(), ["a:3", "b:1"]);
  assert.deepEqual(Object.keys(MAP).sort(), ["a:1", "a:2", "b:1"]); // input untouched
});

test("applySyncResult incremental: upserts, keeps the rest of the slice", () => {
  const out = applySyncResult(MAP, "a", {
    kind: "incremental",
    bookmarks: [bm("a:2", { title: "updated" }), bm("a:9")],
  });
  assert.deepEqual(Object.keys(out).sort(), ["a:1", "a:2", "a:9", "b:1"]);
  assert.equal(out["a:2"].title, "updated");
});

test("applySyncResult unchanged: identity", () => {
  assert.equal(applySyncResult(MAP, "a", { kind: "unchanged", bookmarks: [] }), MAP);
});

// ---- pruneBookmarks -------------------------------------------------------------

test("pruneBookmarks drops slices of removed providers", () => {
  const out = pruneBookmarks(MAP, ["a"]);
  assert.deepEqual(Object.keys(out).sort(), ["a:1", "a:2"]);
});

// ---- maxModifiedCursor ----------------------------------------------------------

test("maxModifiedCursor: highest dateModified wins, date is the fallback", () => {
  const cursor = maxModifiedCursor([
    bm("a:1", { dateModified: "2026-01-02T00:00:00.000Z" }),
    bm("a:2", { date: "2026-03-01T00:00:00.000Z" }), // no dateModified → date
    bm("a:3", { dateModified: "2026-02-01T00:00:00.000Z" }),
  ]);
  assert.equal(cursor, "2026-03-01T00:00:00.000Z");
});

test("maxModifiedCursor: previous cursor is kept unless beaten; empty input keeps it", () => {
  assert.equal(
    maxModifiedCursor([bm("a:1", { dateModified: "2026-01-01T00:00:00.000Z" })], "2026-06-01T00:00:00.000Z"),
    "2026-06-01T00:00:00.000Z"
  );
  assert.equal(maxModifiedCursor([], "2026-06-01T00:00:00.000Z"), "2026-06-01T00:00:00.000Z");
  assert.equal(maxModifiedCursor([bm("a:1")]), undefined);
});

// ---- mergeSyncErrors ------------------------------------------------------------

test("mergeSyncErrors: keeps errors of untouched providers, replaces attempted, drops removed", () => {
  const previous = [
    { name: "ld", message: "401", providerId: "ld" },
    { name: "feed", message: "timeout", providerId: "feed" },
    { name: "gone", message: "x", providerId: "gone" },
    { name: "legacy", message: "no id" }, // pre-rework entry without providerId
  ];
  const merged = mergeSyncErrors(
    previous,
    new Set(["ld"]),
    [{ name: "ld", message: "403", providerId: "ld" }],
    ["ld", "feed"]
  );
  assert.deepEqual(merged, [
    { name: "feed", message: "timeout", providerId: "feed" },
    { name: "ld", message: "403", providerId: "ld" },
  ]);
});

test("mergeSyncErrors: successful retry clears the provider's old error", () => {
  const merged = mergeSyncErrors(
    [{ name: "ld", message: "401", providerId: "ld" }],
    new Set(["ld"]),
    [],
    ["ld"]
  );
  assert.deepEqual(merged, []);
});
