import type { Bookmark, BookmarkProvider, LinkdingProviderConfig, LinkdingResponse } from "../types";
import { toIsoDate } from "../validation";

export class LinkdingProvider implements BookmarkProvider {
  constructor(private config: LinkdingProviderConfig) {}

  async sync(): Promise<Bookmark[]> {
    const bookmarks: Bookmark[] = [];
    let url: string | null = new URL("/api/bookmarks/?limit=100", this.config.url).toString();

    while (url) {
      const response = await this.fetchPage(url);
      for (const b of response.results) {
        const date = toIsoDate(b.date_added);
        bookmarks.push({
          id: `${this.config.id}:${b.id}`,
          url: b.url,
          title: b.title || b.url,
          tag_names: b.tag_names,
          ...(b.favicon_url ? { favicon_url: b.favicon_url } : {}),
          ...(date ? { date } : {}),
        });
      }
      url = response.next;
    }

    return bookmarks;
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
