import type { Bookmark, BookmarkProvider, JsonFeedProviderConfig } from "../types";
import { parseJsonFeed } from "../validation";
import { debugWarn } from "../debug";

export class JsonFeedProvider implements BookmarkProvider {
  constructor(private config: JsonFeedProviderConfig) {}

  async sync(): Promise<Bookmark[]> {
    if (!this.config.url.trim()) return [];

    const response = await fetch(this.config.url, {
      headers: { Accept: "application/feed+json, application/json" },
    });
    if (!response.ok) {
      throw new Error(`JSON Feed error: HTTP ${response.status}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error("JSON Feed error: response is not valid JSON");
    }

    const result = parseJsonFeed(data, this.config.id, this.config.preferExternalUrl);
    if (!result.valid) {
      throw new Error(`JSON Feed error: ${result.errors.join("; ")}`);
    }
    if (result.errors.length > 0) {
      debugWarn(`Provider "${this.config.name}": skipped feed items:`, result.errors);
    }
    return result.bookmarks;
  }
}
