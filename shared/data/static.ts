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
  // Showcases the `browser_base` condition: one folder that shows the current
  // browser's internal pages only. `browser` tags the group; the nested any-group
  // pairs the `firefox`/`chromium` tag with the build's browser base, so on Firefox
  // only the firefox-tagged pages match and on Chromium only the chromium ones — a
  // single, always-non-empty folder rather than an empty per-browser folder on the
  // other build.
  {
    id: "00000000-0000-0000-0000-000000000005",
    name: "Browser tools",
    rules: {
      match: "all",
      conditions: [
        { type: "tag", value: "browser" },
        {
          match: "any",
          conditions: [
            {
              match: "all",
              conditions: [
                { type: "browser_base", value: "firefox" },
                { type: "tag", value: "firefox" },
              ],
            },
            {
              match: "all",
              conditions: [
                { type: "browser_base", value: "chromium" },
                { type: "tag", value: "chromium" },
              ],
            },
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
  // Browser-internal pages — gated per browser by the "Browser tools" folder above.
  // Only shown/openable on the matching build (see the browser_base condition).
  // Tagged with a shared `browser` tag plus a per-base `firefox`/`chromium` tag.
  {
    id: "18",
    url: "about:debugging#/runtime/this-firefox",
    title: "Debug Add-ons",
    tag_names: ["browser", "firefox"],
  },
  {
    id: "19",
    url: "about:addons",
    title: "Add-ons Manager",
    tag_names: ["browser", "firefox"],
  },
  {
    id: "20",
    url: "about:config",
    title: "Advanced Configuration",
    tag_names: ["browser", "firefox"],
  },
  {
    id: "21",
    url: "about:processes",
    title: "Task Manager",
    tag_names: ["browser", "firefox"],
  },
  {
    id: "22",
    url: "chrome://extensions",
    title: "Extensions",
    tag_names: ["browser", "chromium"],
  },
  {
    id: "23",
    url: "chrome://inspect",
    title: "Inspect Devices",
    tag_names: ["browser", "chromium"],
  },
  {
    id: "24",
    url: "chrome://flags",
    title: "Experiments",
    tag_names: ["browser", "chromium"],
  },
  {
    id: "25",
    url: "chrome://version",
    title: "Version",
    tag_names: ["browser", "chromium"],
  },
  {
    id: "26",
    url: "about:preferences",
    title: "Settings",
    tag_names: ["browser", "firefox"],
  },
  {
    id: "27",
    url: "chrome://settings",
    title: "Settings",
    tag_names: ["browser", "chromium"],
  },
];
