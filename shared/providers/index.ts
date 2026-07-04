import type { BookmarkProvider, ProviderConfig } from "../types";
import { StaticProvider } from "./static";
import { JsonProvider } from "./json";
import { BrowserProvider } from "./browser";
import { LinkdingProvider } from "./linkding";
import { JsonFeedProvider } from "./jsonfeed";

export function createProvider(config: ProviderConfig): BookmarkProvider {
  switch (config.type) {
    case "static":   return new StaticProvider(config);
    case "json":     return new JsonProvider(config);
    case "browser":  return new BrowserProvider(config);
    case "linkding": return new LinkdingProvider(config);
    case "jsonfeed": return new JsonFeedProvider(config);
  }
}
