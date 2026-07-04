import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXmlFeed, decodeFeedBytes } from "../shared/rss";

test("parseXmlFeed: RSS 2.0 with CDATA title, categories, and permalink guid", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Example Blog</title>
        <item>
          <title><![CDATA[Hello <b>world</b> &amp; friends]]></title>
          <link>https://blog.example/hello</link>
          <guid isPermaLink="true">https://blog.example/hello</guid>
          <category>dev</category>
          <category domain="https://taxonomy.example">news</category>
        </item>
        <item>
          <title>No guid item</title>
          <link>https://blog.example/second</link>
        </item>
      </channel>
    </rss>`;
  const result = parseXmlFeed(xml, "feed-1");
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.bookmarks, [
    {
      id: "feed-1:https://blog.example/hello",
      url: "https://blog.example/hello",
      title: "Hello world & friends",
      tag_names: ["dev", "news"],
    },
    {
      id: "feed-1:https://blog.example/second",
      url: "https://blog.example/second",
      title: "No guid item",
      tag_names: [],
    },
  ]);
});

test("parseXmlFeed: RSS guid isPermaLink=false is an id, not a URL", () => {
  const xml = `<rss version="2.0"><channel>
    <item>
      <title>Opaque guid</title>
      <link>https://blog.example/post</link>
      <guid isPermaLink="false">urn:uuid:1234</guid>
    </item>
    <item>
      <title>Guid only, not a permalink</title>
      <guid isPermaLink="false">urn:uuid:5678</guid>
    </item>
  </channel></rss>`;
  const result = parseXmlFeed(xml, "p");
  assert.equal(result.bookmarks.length, 1);
  assert.equal(result.bookmarks[0].id, "p:urn:uuid:1234");
  assert.equal(result.bookmarks[0].url, "https://blog.example/post");
  assert.match(result.errors[0], /items\[1\].*no usable URL/);
});

test("parseXmlFeed: RSS title falls back to description, truncated", () => {
  const xml = `<rss version="2.0"><channel>
    <item>
      <link>https://blog.example/untitled</link>
      <description><![CDATA[<p>A &#8220;micro&#8221; post ${"y".repeat(100)}</p>]]></description>
    </item>
    <item><link>https://blog.example/bare</link></item>
  </channel></rss>`;
  const result = parseXmlFeed(xml, "p");
  assert.equal(result.bookmarks[0].title.length, 80);
  assert.match(result.bookmarks[0].title, /^A “micro” post y+…$/);
  assert.equal(result.bookmarks[1].title, "https://blog.example/bare");
});

test("parseXmlFeed: Atom entries with rel links, term categories, html titles", () => {
  const xml = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Example Atom</title>
      <entry>
        <id>tag:example.org,2026:1</id>
        <title type="html">Fancy &lt;em&gt;title&lt;/em&gt;</title>
        <link rel="self" href="https://atom.example/entry/1.xml"/>
        <link rel="alternate" href="https://atom.example/entry/1"/>
        <category term="comics"/>
        <category term="art"/>
      </entry>
      <entry>
        <id>tag:example.org,2026:2</id>
        <title>Plain</title>
        <link href="https://atom.example/entry/2"/>
      </entry>
    </feed>`;
  const result = parseXmlFeed(xml, "a");
  assert.equal(result.valid, true);
  assert.deepEqual(result.bookmarks, [
    {
      id: "a:tag:example.org,2026:1",
      url: "https://atom.example/entry/1",
      title: "Fancy title",
      tag_names: ["comics", "art"],
    },
    {
      id: "a:tag:example.org,2026:2",
      url: "https://atom.example/entry/2",
      title: "Plain",
      tag_names: [],
    },
  ]);
});

test("parseXmlFeed: RSS 1.0 (RDF) items with dc:subject", () => {
  const xml = `<?xml version="1.0"?>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
             xmlns="http://purl.org/rss/1.0/"
             xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel rdf:about="https://rdf.example/">
        <title>RDF Feed</title>
      </channel>
      <item rdf:about="https://rdf.example/story-1">
        <title>Story one</title>
        <link>https://rdf.example/story-1</link>
        <dc:subject>science</dc:subject>
      </item>
    </rdf:RDF>`;
  const result = parseXmlFeed(xml, "r");
  assert.equal(result.valid, true);
  assert.deepEqual(result.bookmarks, [
    {
      id: "r:https://rdf.example/story-1",
      url: "https://rdf.example/story-1",
      title: "Story one",
      tag_names: ["science"],
    },
  ]);
});

test("parseXmlFeed: unsafe and missing URLs are skipped with notes", () => {
  const xml = `<rss version="2.0"><channel>
    <item><title>bad</title><link>javascript:alert(1)</link></item>
    <item><title>good</title><link>https://ok.example/</link></item>
  </channel></rss>`;
  const result = parseXmlFeed(xml, "p");
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.bookmarks.map((b) => b.url), ["https://ok.example/"]);
});

test("parseXmlFeed rejects non-feed and unparseable documents", () => {
  for (const bad of ["<html><body>hi</body></html>", "{}", "plain text", "<broken><"]) {
    const result = parseXmlFeed(bad, "p");
    assert.equal(result.valid, false, `should reject: ${bad}`);
    assert.deepEqual(result.bookmarks, []);
  }
});

test("parseXmlFeed: empty feeds are valid with zero bookmarks", () => {
  assert.deepEqual(parseXmlFeed("<rss><channel><title>x</title></channel></rss>", "p").bookmarks, []);
  assert.deepEqual(parseXmlFeed('<feed xmlns="http://www.w3.org/2005/Atom"/>', "p").bookmarks, []);
});

// ---- decodeFeedBytes ----------------------------------------------------------

test("decodeFeedBytes: UTF-8 by default, prolog-declared latin-1 honoured", () => {
  const utf8 = new TextEncoder().encode('<?xml version="1.0"?><rss/>');
  assert.equal(decodeFeedBytes(utf8.buffer as ArrayBuffer), '<?xml version="1.0"?><rss/>');

  // "Grüße" in latin-1: 0xFC = ü, 0xDF = ß — mojibake if read as UTF-8
  const prolog = '<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><title>Gr';
  const tail = "e</title></channel></rss>";
  const bytes = new Uint8Array([
    ...new TextEncoder().encode(prolog),
    0xfc, 0xdf,
    ...new TextEncoder().encode(tail),
  ]);
  const decoded = decodeFeedBytes(bytes.buffer as ArrayBuffer);
  assert.match(decoded, /Grüße/);
});

test("decodeFeedBytes: unknown encoding label falls back to UTF-8", () => {
  const bytes = new TextEncoder().encode('<?xml version="1.0" encoding="not-a-charset"?><rss/>');
  assert.match(decodeFeedBytes(bytes.buffer as ArrayBuffer), /<rss\/>/);
});

test("parseXmlFeed: pubDate, dc:date, and Atom published/updated become dates", () => {
  const rss = parseXmlFeed(
    `<rss version="2.0"><channel><item>
       <link>https://a.example/1</link><title>t</title>
       <pubDate>Thu, 02 Jul 2026 22:30:40 GMT</pubDate>
     </item></channel></rss>`,
    "p"
  );
  assert.equal(rss.bookmarks[0].date, "2026-07-02T22:30:40.000Z");

  const rdf = parseXmlFeed(
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
              xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
       <channel rdf:about="https://r.example/"><title>r</title></channel>
       <item rdf:about="https://r.example/1">
         <title>t</title><link>https://r.example/1</link>
         <dc:date>2026-07-01T08:00:00Z</dc:date>
       </item>
     </rdf:RDF>`,
    "p"
  );
  assert.equal(rdf.bookmarks[0].date, "2026-07-01T08:00:00.000Z");

  const atom = parseXmlFeed(
    `<feed xmlns="http://www.w3.org/2005/Atom">
       <entry><id>1</id><title>t</title><link href="https://a.example/1"/>
         <updated>2026-06-30T12:00:00Z</updated>
       </entry>
     </feed>`,
    "p"
  );
  assert.equal(atom.bookmarks[0].date, "2026-06-30T12:00:00.000Z");
});
