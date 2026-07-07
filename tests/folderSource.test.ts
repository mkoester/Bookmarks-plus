import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchFolderSource,
  folderSourceDue,
  nextFolderSourceState,
} from "../shared/folderSource";
import { alarmPeriodMinutes, fnv1a } from "../shared/sync";
import type { FolderSourceConfig, FolderSourceState, Settings } from "../shared/types";

const NOW = Date.parse("2026-07-07T12:00:00Z");
const URL_A = "https://raw.example.com/folders.json";

function config(overrides: Partial<FolderSourceConfig> = {}): FolderSourceConfig {
  return { url: URL_A, ...overrides };
}

function state(overrides: Partial<FolderSourceState> = {}): FolderSourceState {
  const iso = new Date(NOW).toISOString();
  return { lastSyncAt: iso, lastAttemptAt: iso, fingerprint: URL_A, ...overrides };
}

const VALID_FOLDERS_JSON = JSON.stringify([
  { name: "Dev", rules: { match: "any", conditions: [{ type: "tag", value: "dev" }] } },
]);

// ---- folderSourceDue ------------------------------------------------------------

test("folderSourceDue: unconfigured or blank URL is never due", () => {
  assert.equal(folderSourceDue(undefined, undefined, NOW, true), false);
  assert.equal(folderSourceDue(config({ url: "  " }), undefined, NOW, true), false);
});

test("folderSourceDue: forced (Sync folders now) is always due", () => {
  assert.equal(folderSourceDue(config(), state(), NOW, true), true);
});

test("folderSourceDue: never fetched or URL changed is due", () => {
  assert.equal(folderSourceDue(config(), undefined, NOW, false), true);
  assert.equal(
    folderSourceDue(config(), state({ fingerprint: "https://elsewhere.example/f.json" }), NOW, false),
    true
  );
});

test("folderSourceDue: manual-only (no interval) is not due once fetched", () => {
  assert.equal(folderSourceDue(config(), state(), NOW, false), false);
  assert.equal(
    folderSourceDue(config({ syncIntervalMinutes: 0 }), state(), NOW, false),
    false // insane interval = manual only
  );
});

test("folderSourceDue: opt-in interval follows the last attempt", () => {
  const cfg = config({ syncIntervalMinutes: 30 });
  const past = new Date(NOW - 31 * 60_000).toISOString();
  const recent = new Date(NOW - 29 * 60_000).toISOString();
  assert.equal(folderSourceDue(cfg, state({ lastAttemptAt: past }), NOW, false), true);
  assert.equal(folderSourceDue(cfg, state({ lastAttemptAt: recent }), NOW, false), false);
});

// ---- alarmPeriodMinutes with a folder source --------------------------------------

test("alarmPeriodMinutes: folder-source interval joins the race; manual-only doesn't", () => {
  const settings: Settings = {
    syncIntervalMinutes: 15,
    theme: "system",
    newTabCloseOnOpenAll: false,
    providers: [],
    folderSource: { url: URL_A, syncIntervalMinutes: 5 },
  };
  assert.equal(alarmPeriodMinutes(settings), 5);
  settings.folderSource = { url: URL_A }; // manual refresh only
  assert.equal(alarmPeriodMinutes(settings), 15);
});

// ---- nextFolderSourceState ---------------------------------------------------------

const ISO = new Date(NOW).toISOString();

test("nextFolderSourceState: full fetch stores the fresh validators and hash", () => {
  const next = nextFolderSourceState(
    state({ etag: "old", contentHash: "old-hash" }),
    URL_A,
    ISO,
    { kind: "full", folders: [], etag: "new", lastModified: "Mon", contentHash: "new-hash" }
  );
  assert.deepEqual(next, {
    lastSyncAt: ISO,
    lastAttemptAt: ISO,
    fingerprint: URL_A,
    etag: "new",
    lastModified: "Mon",
    contentHash: "new-hash",
  });
});

test("nextFolderSourceState: a 304 (no validators in the result) keeps the previous ones", () => {
  const next = nextFolderSourceState(
    state({ etag: "old", lastModified: "Sun", contentHash: "old-hash" }),
    URL_A,
    ISO,
    { kind: "unchanged", folders: [] }
  );
  assert.equal(next.etag, "old");
  assert.equal(next.lastModified, "Sun");
  assert.equal(next.contentHash, "old-hash");
});

test("nextFolderSourceState: hash-detected unchanged still refreshes the validators", () => {
  const next = nextFolderSourceState(
    state({ etag: "old", contentHash: "same" }),
    URL_A,
    ISO,
    { kind: "unchanged", folders: [], etag: "rotated", contentHash: "same" }
  );
  assert.equal(next.etag, "rotated");
  assert.equal(next.contentHash, "same");
});

// ---- fetchFolderSource -------------------------------------------------------------

// Swaps global fetch for one canned response and records the request.
function mockFetch(
  body: string | null,
  init: { status?: number; headers?: Record<string, string> } = {}
): { requests: Array<{ url: string; headers: Headers }>; restore: () => void } {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, reqInit?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(reqInit?.headers) });
    return new Response(body, { status: init.status ?? 200, headers: init.headers ?? {} });
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("fetchFolderSource: 200 with valid folders is a full result with validators", async () => {
  const mock = mockFetch(VALID_FOLDERS_JSON, {
    headers: { ETag: '"abc"', "Last-Modified": "Mon, 06 Jul 2026 00:00:00 GMT" },
  });
  try {
    const result = await fetchFolderSource(config());
    assert.equal(result.kind, "full");
    assert.equal(result.folders.length, 1);
    assert.equal(result.folders[0].name, "Dev");
    assert.equal(result.etag, '"abc"');
    assert.equal(result.lastModified, "Mon, 06 Jul 2026 00:00:00 GMT");
    assert.equal(result.contentHash, fnv1a(VALID_FOLDERS_JSON));
  } finally {
    mock.restore();
  }
});

test("fetchFolderSource: sends conditional headers only for the same URL", async () => {
  const st = state({ etag: '"abc"', lastModified: "Sun, 05 Jul 2026 00:00:00 GMT" });
  const mock = mockFetch(VALID_FOLDERS_JSON);
  try {
    await fetchFolderSource(config(), st);
    assert.equal(mock.requests[0].headers.get("If-None-Match"), '"abc"');
    assert.equal(mock.requests[0].headers.get("If-Modified-Since"), "Sun, 05 Jul 2026 00:00:00 GMT");

    await fetchFolderSource(config({ url: "https://elsewhere.example/f.json" }), st);
    assert.equal(mock.requests[1].headers.get("If-None-Match"), null);
    assert.equal(mock.requests[1].headers.get("If-Modified-Since"), null);
  } finally {
    mock.restore();
  }
});

test("fetchFolderSource: 304 is unchanged", async () => {
  const mock = mockFetch(null, { status: 304 });
  try {
    const result = await fetchFolderSource(config(), state({ etag: '"abc"' }));
    assert.equal(result.kind, "unchanged");
    assert.equal(result.folders.length, 0);
  } finally {
    mock.restore();
  }
});

test("fetchFolderSource: identical body (by hash) is unchanged — folder ids don't churn", async () => {
  const mock = mockFetch(VALID_FOLDERS_JSON);
  try {
    const result = await fetchFolderSource(
      config(),
      state({ contentHash: fnv1a(VALID_FOLDERS_JSON) })
    );
    assert.equal(result.kind, "unchanged");
    assert.equal(result.contentHash, fnv1a(VALID_FOLDERS_JSON));
  } finally {
    mock.restore();
  }
});

test("fetchFolderSource: HTTP error, bad JSON, and invalid folders all throw", async () => {
  let mock = mockFetch("nope", { status: 404 });
  try {
    await assert.rejects(fetchFolderSource(config()), /HTTP 404/);
  } finally {
    mock.restore();
  }

  mock = mockFetch("not json {");
  try {
    await assert.rejects(fetchFolderSource(config()), /Not valid JSON/);
  } finally {
    mock.restore();
  }

  mock = mockFetch(JSON.stringify([{ name: "" }]));
  try {
    await assert.rejects(fetchFolderSource(config()), /Invalid folder definitions/);
  } finally {
    mock.restore();
  }
});
