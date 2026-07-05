import type { BookmarkProvider, StaticProviderConfig, SyncResult } from "../types";
import { STATIC_BOOKMARKS } from "../data/static";

export class StaticProvider implements BookmarkProvider {
  constructor(private config: StaticProviderConfig) {}

  async sync(): Promise<SyncResult> {
    const bookmarks = STATIC_BOOKMARKS.map((b) => ({
      ...b,
      id: `${this.config.id}:${b.id}`,
    }));
    return { kind: "full", bookmarks };
  }
}
