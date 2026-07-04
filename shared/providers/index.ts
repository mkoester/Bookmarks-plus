import type { BookmarkProvider, ProviderConfig } from "../types";
import { StaticProvider } from "./static";
import { JsonProvider } from "./json";
import { BrowserProvider } from "./browser";
import { LinkdingProvider } from "./linkding";
import { FeedProvider } from "./feed";

export function createProvider(config: ProviderConfig): BookmarkProvider {
  switch (config.type) {
    case "static":   return new StaticProvider(config);
    case "json":     return new JsonProvider(config);
    case "browser":  return new BrowserProvider(config);
    case "linkding": return new LinkdingProvider(config);
    case "feed":     // "jsonfeed" = pre-RSS legacy alias, same provider
    case "jsonfeed": return new FeedProvider(config);
  }
}
