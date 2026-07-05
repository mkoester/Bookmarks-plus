import type { BookmarkProvider, JsonProviderConfig, SyncResult } from "../types";
import { validateBookmarks, entryToBookmark } from "../validation";

export class JsonProvider implements BookmarkProvider {
  constructor(private config: JsonProviderConfig) {}

  async sync(): Promise<SyncResult> {
    if (!this.config.data.trim()) return { kind: "full", bookmarks: [] };

    let parsed: unknown;
    try {
      parsed = JSON.parse(this.config.data);
    } catch {
      console.error(`Provider "${this.config.name}": invalid JSON`);
      return { kind: "full", bookmarks: [] };
    }

    const result = validateBookmarks(parsed);
    if (!result.valid) {
      console.error(`Provider "${this.config.name}": validation errors:`, result.errors);
      return { kind: "full", bookmarks: [] };
    }

    const bookmarks = (parsed as Record<string, unknown>[]).map((entry, i) =>
      entryToBookmark(entry, i, this.config.id)
    );
    return { kind: "full", bookmarks };
  }
}
