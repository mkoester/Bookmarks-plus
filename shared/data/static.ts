import type { Bookmark, Folder } from "../types";

export const STATIC_FOLDERS: Folder[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Crowdsourcing",
    rules: { match: "any", conditions: [{ type: "tag", value: "crowdsourcing" }] },
    bookmark_ids: [],
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Fediverse",
    rules: { match: "any", conditions: [{ type: "tag", value: "fediverse" }] },
    bookmark_ids: [],
  },
  // The next two showcase nested groups (impossible with the old flat rules).
  {
    id: "00000000-0000-0000-0000-000000000003",
    name: "Community (not social media nor crowdsourcing)",
    rules: {
      match: "all",
      conditions: [
        { type: "tag", value: "community" },
        {
          match: "none",
          conditions: [
            { type: "tag", value: "social-media" },
            { type: "tag", value: "crowdsourcing" },
          ],
        },
      ],
    },
    bookmark_ids: [],
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    name: "Open knowledge",
    rules: {
      match: "all",
      conditions: [
        { type: "tag", value: "knowledge" },
        {
          match: "any",
          conditions: [
            { type: "tag", value: "education" },
            { type: "tag", value: "opensource" },
          ],
        },
      ],
    },
    bookmark_ids: [],
  },
];

export const STATIC_BOOKMARKS: Bookmark[] = [
  {
    id: "1",
    url: "https://www.wikipedia.org/",
    title: "Wikipedia",
    tag_names: ["knowledge", "community", "crowdsourcing"],
  },
  {
    id: "2",
    url: "https://joinmastodon.org/",
    title: "Mastodon",
    tag_names: ["social-media", "fediverse", "opensource"],
  },
  {
    id: "3",
    url: "https://signal.org/de/",
    title: "Signal",
    tag_names: ["messenger", "opensource"],
  },
  {
    id: "4",
    url: "https://threema.com/de",
    title: "Threema",
    tag_names: ["messenger", "opensource"],
  },
  {
    id: "5",
    url: "https://www.openstreetmap.org/",
    title: "OpenStreetMap",
    tag_names: ["maps", "community", "crowdsourcing", "opensource"],
  },
  {
    id: "6",
    url: "https://archive.org/",
    title: "Internet Archive",
    tag_names: ["knowledge", "preservation", "community"],
  },
  {
    id: "7",
    url: "https://www.khanacademy.org/",
    title: "Khan Academy",
    tag_names: ["knowledge", "education"],
  },
  {
    id: "8",
    url: "https://creativecommons.org/",
    title: "Creative Commons",
    tag_names: ["knowledge", "opensource", "community"],
  },
  {
    id: "9",
    url: "https://www.eff.org/",
    title: "Electronic Frontier Foundation",
    tag_names: ["privacy", "rights", "advocacy"],
  },
  {
    id: "10",
    url: "https://www.mozilla.org/",
    title: "Mozilla",
    tag_names: ["opensource", "privacy", "advocacy"],
  },
  {
    id: "11",
    url: "https://joinlemmy.ml/",
    title: "Lemmy",
    tag_names: ["social-media", "community", "opensource", "fediverse"],
  },
  {
    id: "12",
    url: "https://tildes.net/",
    title: "Tildes",
    tag_names: ["social-media", "community"],
  },
  {
    id: "13",
    url: "https://joinpeertube.org/",
    title: "PeerTube",
    tag_names: ["video", "opensource", "fediverse"],
  },
  {
    id: "14",
    url: "https://pixelfed.org/",
    title: "Pixelfed",
    tag_names: ["photos", "social-media", "opensource", "fediverse"],
  },
  {
    id: "15",
    url: "https://writefreely.org/",
    title: "WriteFreely",
    tag_names: ["blogging", "opensource", "fediverse"],
  },
  {
    id: "16",
    url: "https://ghost.org/",
    title: "Ghost",
    tag_names: ["blogging", "opensource", "nonprofit"],
  },
  {
    id: "17",
    url: "https://lobste.rs/",
    title: "Lobsters",
    tag_names: ["news", "community", "tech"],
  },
];
