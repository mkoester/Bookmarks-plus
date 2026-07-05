import ext from "../browser";
import { debugLog, debugWarn } from "../debug";
import type { Bookmark, BookmarkProvider, BrowserProviderConfig, SyncResult } from "../types";

export class BrowserProvider implements BookmarkProvider {
  constructor(private config: BrowserProviderConfig) {}

  async sync(): Promise<SyncResult> {
    debugLog(`[BrowserProvider "${this.config.name}"] sync started`);

    const granted = await ext.permissions.contains({ permissions: ["bookmarks"] });
    debugLog(`[BrowserProvider "${this.config.name}"] bookmarks permission granted: ${granted}`);
    if (!granted) {
      debugWarn(`[BrowserProvider "${this.config.name}"] permission not granted — request it from the options page`);
      return { kind: "full", bookmarks: [] };
    }

    const tree = await ext.bookmarks.getTree();

    const bookmarks: Bookmark[] = [];
    this.walk(tree, [], bookmarks);

    debugLog(`[BrowserProvider "${this.config.name}"] imported ${bookmarks.length} bookmarks`);

    return { kind: "full", bookmarks };
  }

  private walk(
    nodes: browser.bookmarks.BookmarkTreeNode[],
    folderPath: string[],
    out: Bookmark[]
  ): void {
    for (const node of nodes) {
      if (node.url) {
        out.push({
          id: `${this.config.id}:${node.id}`,
          url: node.url,
          title: node.title || node.url,
          tag_names: [...folderPath],
          ...(node.dateAdded ? { date: new Date(node.dateAdded).toISOString() } : {}),
        });
      } else if (node.children) {
        const newPath = node.title ? [...folderPath, node.title] : folderPath;
        this.walk(node.children, newPath, out);
      }
    }
  }
}
