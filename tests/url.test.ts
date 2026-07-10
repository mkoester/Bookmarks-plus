import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedBookmarkUrl,
  isAllowedFaviconUrl,
  isPrivilegedNavUrl,
  isCopyOnlyUrl,
} from "../shared/url";

test("isAllowedBookmarkUrl accepts web, mailto, ftp and browser-internal URLs", () => {
  assert.equal(isAllowedBookmarkUrl("https://example.com/page"), true);
  assert.equal(isAllowedBookmarkUrl("http://example.com"), true);
  assert.equal(isAllowedBookmarkUrl("mailto:someone@example.com"), true);
  assert.equal(isAllowedBookmarkUrl("ftp://example.com/file"), true);
  // Browser-internal pages: allowed because they only ever open in a tab, never
  // execute in the extension page (unlike javascript:).
  assert.equal(isAllowedBookmarkUrl("about:debugging#/runtime/this-firefox"), true);
  assert.equal(isAllowedBookmarkUrl("chrome://extensions"), true);
});

test("isAllowedBookmarkUrl rejects script and other privileged schemes", () => {
  assert.equal(isAllowedBookmarkUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedBookmarkUrl("data:text/html,<script>1</script>"), false);
  assert.equal(isAllowedBookmarkUrl("file:///etc/passwd"), false);
});

test("isPrivilegedNavUrl flags about:/chrome:// (not a native anchor), not web URLs", () => {
  assert.equal(isPrivilegedNavUrl("about:config"), true);
  assert.equal(isPrivilegedNavUrl("chrome://extensions"), true);
  assert.equal(isPrivilegedNavUrl("https://example.com"), false);
  assert.equal(isPrivilegedNavUrl("mailto:x@example.com"), false);
  assert.equal(isPrivilegedNavUrl("garbage"), false);
});

test("isCopyOnlyUrl flags Firefox about: pages (unopenable) but not chrome:// or web", () => {
  assert.equal(isCopyOnlyUrl("about:debugging#/runtime/this-firefox"), true);
  assert.equal(isCopyOnlyUrl("about:config"), true);
  assert.equal(isCopyOnlyUrl("chrome://extensions"), false); // opens via tabs.create
  assert.equal(isCopyOnlyUrl("https://example.com"), false);
  assert.equal(isCopyOnlyUrl("garbage"), false);
});

test("isAllowedBookmarkUrl rejects unparseable input", () => {
  assert.equal(isAllowedBookmarkUrl("not a url"), false);
  assert.equal(isAllowedBookmarkUrl(""), false);
});

test("isAllowedFaviconUrl allows data: images but not mailto/javascript", () => {
  assert.equal(isAllowedFaviconUrl("https://example.com/favicon.ico"), true);
  assert.equal(isAllowedFaviconUrl("data:image/svg+xml,<svg/>"), true);
  assert.equal(isAllowedFaviconUrl("mailto:x@example.com"), false);
  assert.equal(isAllowedFaviconUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedFaviconUrl("garbage"), false);
});
