import type {
  Bookmark,
  BookmarkProvider,
  LinkdingProviderConfig,
  LinkdingResponse,
  SyncContext,
  SyncResult,
} from "../types";
import { toIsoDate } from "../validation";

export class LinkdingProvider implements BookmarkProvider {
  constructor(private config: LinkdingProviderConfig) {}

  async sync(ctx?: SyncContext): Promise<SyncResult> {
    // Incremental: only bookmarks modified after the cursor (the highest
    // date_modified seen so far — the server's clock, so client skew can't
    // lose updates). Deletions/archiving are invisible to modified_since;
    // the background loop forces a periodic full sync to reconcile them.
    const since = ctx && !ctx.full ? ctx.since : undefined;

    const query = new URLSearchParams({ limit: "100" });
    if (since !== undefined) query.set("modified_since", since);

    const bookmarks: Bookmark[] = [];
    let url: string | null = new URL(
      `/api/bookmarks/?${query.toString()}`,
      this.config.url
    ).toString();

    while (url) {
      const response = await this.fetchPage(url);
      for (const b of response.results) {
        const date = toIsoDate(b.date_added);
        const dateModified = toIsoDate(b.date_modified);
        bookmarks.push({
          id: `${this.config.id}:${b.id}`,
          url: b.url,
          title: b.title || b.url,
          tag_names: b.tag_names,
          ...(b.favicon_url ? { favicon_url: b.favicon_url } : {}),
          ...(date ? { date } : {}),
          ...(dateModified ? { dateModified } : {}),
        });
      }
      url = response.next;
    }

    return { kind: since !== undefined ? "incremental" : "full", bookmarks };
  }

  private async fetchPage(url: string): Promise<LinkdingResponse> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Token ${this.config.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Linkding API error: HTTP ${response.status}`);
    }

    return response.json() as Promise<LinkdingResponse>;
  }
}
