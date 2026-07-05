import type {
  BookmarkProvider,
  FeedProviderConfig,
  SyncContext,
  SyncResult,
} from "../types";
import type { JsonFeedParseResult } from "../validation";
import { parseJsonFeed } from "../validation";
import { parseXmlFeed, decodeFeedBytes } from "../rss";
import { latestN } from "../bookmarks";
import { debugWarn } from "../debug";

const ACCEPT =
  "application/feed+json, application/rss+xml, application/atom+xml, " +
  "application/xml;q=0.9, application/json;q=0.9, text/xml;q=0.8";

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

// Unified web-feed provider: fetches one URL and auto-detects JSON Feed vs
// RSS/Atom by sniffing the body, so the user never has to know the format.
export class FeedProvider implements BookmarkProvider {
  constructor(private config: FeedProviderConfig) {}

  async sync(ctx?: SyncContext): Promise<SyncResult> {
    if (!this.config.url.trim()) return { kind: "full", bookmarks: [] };

    // Feeds have no standard delta protocol — a body is always the complete
    // current item list. The saving is the HTTP conditional GET: send the
    // validators from the last 200 response and a supporting server answers
    // 304 with no body (skips download + parse). cache: "no-store" bypasses
    // the browser HTTP cache so OUR validators reach the server instead of
    // being answered (or rewritten) by the cache.
    const conditional: Record<string, string> = {};
    if (ctx && !ctx.full) {
      if (ctx.etag) conditional["If-None-Match"] = ctx.etag;
      if (ctx.lastModified) conditional["If-Modified-Since"] = ctx.lastModified;
    }

    const response = await fetch(this.config.url, {
      headers: { Accept: ACCEPT, ...conditional },
      cache: "no-store",
    });
    if (response.status === 304) {
      return { kind: "unchanged", bookmarks: [] };
    }
    if (!response.ok) {
      throw new Error(`Feed error: HTTP ${response.status}`);
    }

    // response.text() honours an HTTP charset header but never the XML prolog;
    // without a header, decode the bytes ourselves (see decodeFeedBytes).
    const contentType = response.headers.get("content-type") ?? "";
    const body = stripBom(
      /charset=/i.test(contentType)
        ? await response.text()
        : decodeFeedBytes(await response.arrayBuffer())
    );

    const head = body.trimStart();
    let result: JsonFeedParseResult;
    if (head.startsWith("{")) {
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch {
        throw new Error("Feed error: looks like JSON but does not parse");
      }
      result = parseJsonFeed(data, this.config.id, this.config.preferExternalUrl);
    } else if (head.startsWith("<")) {
      result = parseXmlFeed(body, this.config.id);
    } else {
      throw new Error("Feed error: response is neither JSON nor XML");
    }

    if (!result.valid) {
      throw new Error(`Feed error: ${result.errors.join("; ")}`);
    }
    if (result.errors.length > 0) {
      debugWarn(`Provider "${this.config.name}": skipped feed items:`, result.errors);
    }

    const max = this.config.maxItems;
    const bookmarks =
      max !== undefined && max > 0 ? latestN(result.bookmarks, max) : result.bookmarks;

    const etag = response.headers.get("ETag");
    const lastModified = response.headers.get("Last-Modified");
    return {
      kind: "full",
      bookmarks,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
    };
  }
}
