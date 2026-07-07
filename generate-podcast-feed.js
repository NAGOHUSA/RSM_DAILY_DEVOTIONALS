// generate-podcast-feed.js — Pulls Rock Solid Man Podcast episodes from the
// Substack RSS feed (the master feed Apple Podcasts & Spotify republish from)
// and writes a clean podcast-episodes.json for the site to fetch client-side.
// Node 18+ (global fetch). No external deps — same style as generate-devotional.js.

import fs from "node:fs/promises";
import path from "node:path";

const RSS_URL = process.env.PODCAST_RSS_URL || "https://api.substack.com/feed/podcast/9723392.rss";
const OUT_PATH = process.env.PODCAST_OUT_PATH || "podcast-episodes.json";
const MAX_EPISODES = Number(process.env.PODCAST_MAX_EPISODES || 100);

// Show page links (used as fallback "listen on" links for every episode,
// since Apple/Spotify per-episode URLs aren't derivable from the RSS alone).
const LINKS = {
  apple: "https://podcasts.apple.com/us/podcast/rock-solid-man-podcast/id6785086184",
  spotify: "https://open.spotify.com/show/033Iv2uBi03xglK5YMEyZL",
  youtube: "https://www.youtube.com/@RSMMINISTRY",
  substack: "https://rocksolidman.substack.com/podcast",
};

function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#38;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(str) {
  if (!str) return "";
  return decodeEntities(str.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return decodeEntities(m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim());
}

function extractAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"[^>]*\\/?>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : "";
}

function formatDuration(itunesDuration) {
  if (!itunesDuration) return "";
  // Already HH:MM:SS or MM:SS
  if (itunesDuration.includes(":")) return itunesDuration;
  const totalSeconds = Number(itunesDuration);
  if (!Number.isFinite(totalSeconds)) return "";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function parseItems(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const guid = extractTag(block, "guid");
    const pubDateRaw = extractTag(block, "pubDate");
    const descriptionHtml = extractTag(block, "description");
    const enclosureUrl = extractAttr(block, "enclosure", "url");
    const duration = extractTag(block, "itunes:duration");
    const image = extractAttr(block, "itunes:image", "href");

    const pubDate = pubDateRaw ? new Date(pubDateRaw).toISOString() : null;
    const summary = stripHtml(descriptionHtml);

    items.push({
      title: title || "Untitled Episode",
      link: link || LINKS.substack,
      guid: guid || link || title,
      pub_date: pubDate,
      summary: summary.length > 400 ? summary.slice(0, 397).trimEnd() + "…" : summary,
      audio_url: enclosureUrl || null,
      duration: formatDuration(duration),
      image: image || null,
    });
  }
  // Newest first
  items.sort((a, b) => new Date(b.pub_date || 0) - new Date(a.pub_date || 0));
  return items.slice(0, MAX_EPISODES);
}

async function main() {
  const res = await fetch(RSS_URL, { headers: { "User-Agent": "RockSolidManPodcastBot/1.0" } });
  if (!res.ok) throw new Error(`Failed to fetch RSS feed: ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const channelBlockMatch = xml.match(/<channel>([\s\S]*?)<item>/);
  const channelBlock = channelBlockMatch ? channelBlockMatch[1] : xml;

  const channel = {
    title: stripHtml(extractTag(channelBlock, "title")) || "Rock Solid Man Podcast",
    image: extractAttr(channelBlock, "itunes:image", "href") || null,
    link: extractTag(channelBlock, "link") || LINKS.substack,
  };

  const episodes = parseItems(xml);

  const payload = {
    generated_at: new Date().toISOString(),
    source_rss: RSS_URL,
    channel,
    links: LINKS,
    episode_count: episodes.length,
    episodes,
  };

  await fs.writeFile(path.resolve(OUT_PATH), JSON.stringify(payload, null, 2) + "\n", "utf-8");
  console.log(`✅ Wrote ${OUT_PATH} with ${episodes.length} episode(s)`);
}

main().catch((err) => {
  console.error("❌ Podcast feed generation failed:", err);
  process.exit(1);
});
