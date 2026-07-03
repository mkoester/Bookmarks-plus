import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedBookmarkUrl, isAllowedFaviconUrl } from "../shared/url";

test("isAllowedBookmarkUrl accepts web, mailto and ftp URLs", () => {
  assert.equal(isAllowedBookmarkUrl("https://example.com/page"), true);
  assert.equal(isAllowedBookmarkUrl("http://example.com"), true);
  assert.equal(isAllowedBookmarkUrl("mailto:someone@example.com"), true);
  assert.equal(isAllowedBookmarkUrl("ftp://example.com/file"), true);
});

test("isAllowedBookmarkUrl rejects privileged and inline schemes", () => {
  assert.equal(isAllowedBookmarkUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedBookmarkUrl("data:text/html,<script>1</script>"), false);
  assert.equal(isAllowedBookmarkUrl("chrome://settings"), false);
  assert.equal(isAllowedBookmarkUrl("file:///etc/passwd"), false);
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
