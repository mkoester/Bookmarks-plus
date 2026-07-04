// RSS/Atom → Bookmark mapping for the unified feed provider. Pure module: uses
// fast-xml-parser (no DOMParser — unavailable in the Chrome MV3 service worker)
// so the same code runs in Firefox's event page, Chrome's worker, and node tests.
import { XMLParser } from "fast-xml-parser";
import type { Bookmark } from "./types";
import type { JsonFeedParseResult } from "./validation";
import { deriveTitle, stripHtml, toIsoDate } from "./validation";
import { isAllowedBookmarkUrl } from "./url";

// removeNSPrefix folds rdf:RDF → RDF and dc:subject → subject, so RSS 1.0 (RDF)
// feeds share the RSS item mapping. parseTagValue/parseAttributeValue stay off so
// numeric-looking ids and titles remain strings.
function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name, jpathOrMatcher) => {
      // fxp v5 passes a MatcherView instead of a string unless jPath: true
      const jpath = typeof jpathOrMatcher === "string" ? jpathOrMatcher : jpathOrMatcher.toString();
      return (
        jpath === "rss.channel.item" ||
        jpath === "RDF.item" ||
        jpath === "feed.entry" ||
        jpath.endsWith("entry.link") ||
        name === "category" ||
        name === "subject"
      );
    },
  });
}

// fast-xml-parser yields a plain string for text-only elements, but an object
// with "#text" once attributes are present.
function textOf(node: unknown): string {
  if (typeof node === "string") return node.trim();
  if (typeof node === "object" && node !== null) {
    const text = (node as Record<string, unknown>)["#text"];
    if (typeof text === "string") return text.trim();
  }
  return "";
}

function attrOf(node: unknown, attr: string): string {
  if (typeof node === "object" && node !== null) {
    const value = (node as Record<string, unknown>)[attr];
    if (typeof value === "string") return value.trim();
  }
  return "";
}

// RSS <category> / RDF <dc:subject> carry the tag as text; Atom <category> in
// a term attribute. Accept either from any node.
function categoriesOf(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((c) => textOf(c) || attrOf(c, "@_term"))
    .filter((t) => t !== "");
}

interface ItemCandidate {
  url: string;
  rawId: string;
  title: string;
  tags: string[];
  date?: string;
}

// Shared by RSS 2.0/0.9x and RSS 1.0 (RDF) items.
function rssItemToCandidate(item: Record<string, unknown>): ItemCandidate {
  const link = textOf(item.link);
  const guidText = textOf(item.guid);
  const guidIsPermalink = attrOf(item.guid, "@_isPermaLink").toLowerCase() !== "false";
  const url = link || (guidIsPermalink ? guidText : "");
  const description = textOf(item.description);
  return {
    url,
    rawId: guidText || attrOf(item, "@_about") || url,
    // RSS titles are nominally plain text, but CDATA-wrapped HTML and HTML
    // entities are common in the wild — stripHtml normalises both.
    title: deriveTitle(stripHtml(textOf(item.title)), undefined, description, url),
    tags: [...categoriesOf(item.category), ...categoriesOf(item.subject)],
    // RSS 2.0 <pubDate> (RFC 822); RDF uses <dc:date> → "date" after prefix removal
    date: toIsoDate(textOf(item.pubDate)) ?? toIsoDate(textOf(item.date)),
  };
}

function atomEntryToCandidate(entry: Record<string, unknown>): ItemCandidate {
  const links = Array.isArray(entry.link) ? entry.link : [];
  const alternate =
    links.find((l) => attrOf(l, "@_rel") === "alternate") ??
    links.find((l) => attrOf(l, "@_rel") === "") ?? // no rel means alternate per spec
    links[0];
  const url = attrOf(alternate, "@_href");
  const summary = textOf(entry.summary) || textOf(entry.content);
  return {
    url,
    rawId: textOf(entry.id) || url,
    // type="html" titles arrive as an HTML string after XML entity decoding;
    // stripHtml is a no-op for the plain-text case.
    title: deriveTitle(stripHtml(textOf(entry.title)), undefined, summary, url),
    tags: categoriesOf(entry.category),
    date: toIsoDate(textOf(entry.published)) ?? toIsoDate(textOf(entry.updated)),
  };
}

function findItems(doc: Record<string, unknown>): {
  items: Record<string, unknown>[];
  toCandidate: (item: Record<string, unknown>) => ItemCandidate;
} | null {
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel) {
    return { items: (channel.item as Record<string, unknown>[]) ?? [], toCandidate: rssItemToCandidate };
  }
  const rdf = doc.RDF as Record<string, unknown> | undefined;
  if (rdf) {
    return { items: (rdf.item as Record<string, unknown>[]) ?? [], toCandidate: rssItemToCandidate };
  }
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    return { items: (feed.entry as Record<string, unknown>[]) ?? [], toCandidate: atomEntryToCandidate };
  }
  return null;
}

// Maps an RSS 2.0/0.9x, RSS 1.0 (RDF), or Atom document to Bookmarks namespaced
// under providerId. Same result contract as parseJsonFeed: valid:false only when
// the document is not a feed at all; per-item problems skip the item with a note.
export function parseXmlFeed(xmlText: string, providerId: string): JsonFeedParseResult {
  let doc: unknown;
  try {
    doc = createParser().parse(xmlText);
  } catch (e) {
    return {
      valid: false,
      errors: [`not parseable as XML: ${e instanceof Error ? e.message : String(e)}`],
      bookmarks: [],
    };
  }
  if (typeof doc !== "object" || doc === null) {
    return { valid: false, errors: ["not parseable as XML"], bookmarks: [] };
  }

  const found = findItems(doc as Record<string, unknown>);
  if (!found) {
    return {
      valid: false,
      errors: ["not a recognized feed: expected an rss, rdf:RDF, or feed root element"],
      bookmarks: [],
    };
  }

  const errors: string[] = [];
  const bookmarks: Bookmark[] = [];
  found.items.forEach((item, index) => {
    if (typeof item !== "object" || item === null) {
      errors.push(`items[${index}]: not an element, skipped`);
      return;
    }
    const candidate = found.toCandidate(item);
    if (!candidate.url || !isAllowedBookmarkUrl(candidate.url)) {
      errors.push(`items[${index}]: no usable URL, skipped`);
      return;
    }
    bookmarks.push({
      id: `${providerId}:${candidate.rawId}`,
      url: candidate.url,
      title: candidate.title,
      tag_names: candidate.tags,
      ...(candidate.date ? { date: candidate.date } : {}),
    });
  });

  return { valid: true, errors, bookmarks };
}

// Decodes a fetched feed body. fetch's response.text() only honours the HTTP
// charset header and otherwise assumes UTF-8 — it never reads the XML prolog.
// Older feeds (notably German ones) still declare iso-8859-1 there, so when the
// UTF-8 view reveals a different prolog encoding, re-decode with that label.
export function decodeFeedBytes(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const match = utf8.slice(0, 200).match(/<\?xml[^>]*encoding=["']([^"']+)["']/i);
  const encoding = match?.[1].toLowerCase();
  if (encoding && encoding !== "utf-8" && encoding !== "utf8") {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      // unknown encoding label — keep the UTF-8 interpretation
    }
  }
  return utf8;
}
