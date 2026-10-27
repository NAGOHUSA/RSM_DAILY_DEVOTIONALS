// generate-social-feed.js — Pulls the latest Rock Solid Man YouTube uploads and
// Substack posts and writes them into social-feed.json ("auto" list) so the
// homepage feed always has fresh posts. Hand-written posts in "posts" are kept.
// Node 18+ (global fetch). No external deps — same style as generate-podcast-feed.js.

import fs from "node:fs/promises";

const OUT_PATH = process.env.SOCIAL_OUT_PATH || "social-feed.json";
const YT_HANDLE_URL = process.env.YT_HANDLE_URL || "https://www.youtube.com/@RSMMINISTRY";
const YT_CHANNEL_ID = process.env.YT_CHANNEL_ID || ""; // optional: skip the lookup if you know it (starts with UC…)
const SUBSTACK_RSS = process.env.SUBSTACK_RSS || "https://rocksolidman.substack.com/feed";
const MAX_PER_SOURCE = Number(process.env.SOCIAL_MAX_PER_SOURCE || 6);

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripHtml(str) {
  return decodeEntities(String(str || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!m) return "";
  return m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
}

function attr(block, name, attribute) {
  const m = block.match(new RegExp(`<${name}[^>]*\\s${attribute}="([^"]*)"`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

function clip(text, max = 220) {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

async function getText(url, headers = {}) {
  const res = await fetch(url, { headers: { ...BROWSER_HEADERS, ...headers } });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

// Try direct, then public read-only proxies (GitHub runner IPs are often blocked by Cloudflare).
async function getFeedXml(url) {
  const attempts = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  ];
  const errors = [];
  for (const u of attempts) {
    try {
      const text = await getText(u, { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8" });
      if (/<(rss|feed|channel)[\s>]/i.test(text)) return text;
      errors.push(`${u} -> 200 but not a feed`);
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error(errors.join("\n  "));
}

/* ---------- YouTube ---------- */
async function resolveChannelId() {
  if (YT_CHANNEL_ID) return YT_CHANNEL_ID;
  const html = await getText(YT_HANDLE_URL, { Accept: "text/html" });
  const m =
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
    html.match(/"externalId":"(UC[\w-]{22})"/) ||
    html.match(/"channelId":"(UC[\w-]{22})"/);
  if (!m) throw new Error("Could not find the YouTube channel ID on " + YT_HANDLE_URL);
  return m[1];
}

export function parseYouTube(xml) {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.slice(0, MAX_PER_SOURCE).map((e) => {
    const title = stripHtml(tag(e, "title"));
    const description = stripHtml(tag(e, "media:description"));
    const link = attr(e, "link", "href");
    const isShort = /\/shorts\//.test(link);
    return {
      platform: "youtube",
      date: tag(e, "published") || null,
      title,
      text: clip(description || title),
      url: link || YT_HANDLE_URL,
      image: attr(e, "media:thumbnail", "url") || null,
      kind: isShort ? "short" : "video",
    };
  });
}

/* ---------- Substack ---------- */
export function parseSubstack(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.slice(0, MAX_PER_SOURCE).map((i) => {
    const pub = tag(i, "pubDate");
    const encType = attr(i, "enclosure", "type");
    return {
      platform: "substack",
      date: pub ? new Date(pub).toISOString() : null,
      title: stripHtml(tag(i, "title")),
      text: clip(stripHtml(tag(i, "description"))),
      url: stripHtml(tag(i, "link")),
      image: encType.startsWith("image") ? attr(i, "enclosure", "url") : null,
      kind: encType.startsWith("audio") ? "podcast" : "post",
    };
  });
}

async function main() {
  let existing = { posts: [], auto: [] };
  try {
    existing = JSON.parse(await fs.readFile(OUT_PATH, "utf8"));
  } catch {
    console.log(`No existing ${OUT_PATH}; starting fresh.`);
  }

  const auto = [];
  let anySuccess = false;

  try {
    const id = await resolveChannelId();
    const xml = await getFeedXml(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
    const items = parseYouTube(xml);
    auto.push(...items);
    anySuccess = true;
    console.log(`YouTube: ${items.length} items (channel ${id})`);
  } catch (e) {
    console.warn("YouTube fetch failed:\n  " + e.message);
  }

  try {
    const xml = await getFeedXml(SUBSTACK_RSS);
    const items = parseSubstack(xml);
    auto.push(...items);
    anySuccess = true;
    console.log(`Substack: ${items.length} items`);
  } catch (e) {
    console.warn("Substack fetch failed:\n  " + e.message);
  }

  if (!anySuccess) {
    console.warn("Nothing fetched — leaving social-feed.json unchanged.");
    return;
  }

  auto.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const payload = {
    _howto: existing._howto,
    generated_at: new Date().toISOString(),
    posts: Array.isArray(existing.posts) ? existing.posts : [],
    auto,
  };
  await fs.writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT_PATH}: ${payload.posts.length} manual + ${auto.length} auto items.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
