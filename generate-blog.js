#!/usr/bin/env node
/**
 * generate-blog.js -- publishes the Daily Word devotionals as real, indexable pages (2026-11-10).
 *
 *   devotionals/YYYY-MM-DD.json  ->  blog/YYYY-MM-DD/index.html   one page per devotional (title, meta description,
 *                                                                 canonical, Article structured data, site header/footer)
 *                                    blog/index.html              the archive, newest first, grouped by month
 *                                    blog/posts.json              post list for RunSheets' Website Stats & SEO
 *                                    blog/feed.xml                RSS
 *                                    sitemap.xml                  the <!-- blog:start --> ... <!-- blog:end --> block is
 *                                                                 rewritten with every post; the rest is left alone
 *
 * Run by .github/workflows/daily-devotional.yml right after a new devotional is generated. No dependencies.
 * Safe to re-run: output is fully rebuilt from the JSON each time. Files that don't parse are skipped.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SITE = 'https://rocksolidman.org';
const ROOT = __dirname;
const SRC = path.join(ROOT, 'devotionals');
const OUT = path.join(ROOT, 'blog');
const TEMPLATE_PAGE = path.join(ROOT, 'videos.html'); // header + footer are copied from a live page so they never drift

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strip = (s) => String(s || '').replace(/\*\*?|__?|`/g, '').replace(/\s+/g, ' ').trim();
const fmtDate = (ymd) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtMonth = (ym) => new Date(ym + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>');
}

/** Small Markdown -> HTML for the devotional format (headings, paragraphs, quotes, lists). Drops the H1 (used as title). */
function markdown(md) {
  const blocks = String(md || '').replace(/\r/g, '').split(/\n{2,}/);
  const out = [];
  for (let b of blocks) {
    b = b.trim();
    if (!b || /^#\s/.test(b)) continue;
    let m;
    if ((m = b.match(/^(#{2,4})\s+(.*)$/s))) { out.push('<h2>' + inline(m[2].trim()) + '</h2>'); continue; }
    if (/^>\s?/.test(b)) { out.push('<blockquote><p>' + inline(b.replace(/^>\s?/gm, '').replace(/\n/g, ' ')) + '</p></blockquote>'); continue; }
    if (/^([-*]|\d+\.)\s/.test(b)) {
      const tag = /^\d+\./.test(b) ? 'ol' : 'ul';
      out.push('<' + tag + '>' + b.split('\n').map((l) => '<li>' + inline(l.replace(/^([-*]|\d+\.)\s+/, '')) + '</li>').join('') + '</' + tag + '>');
      continue;
    }
    out.push('<p>' + inline(b.replace(/\n/g, ' ')) + '</p>');
  }
  return out.join('\n');
}

/** Scripture reference: "— Isaiah 40:31", or a heading like "## John 10:11". */
function scriptureRef(md) {
  const REF = /((?:[1-3]\s)?[A-Z][a-z]+(?:\s(?:of\s)?[A-Z][a-z]+)?\s\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?)/;
  const dash = String(md).match(new RegExp('[—–-]\\s*' + REF.source));
  if (dash) return dash[1];
  const h = String(md).match(new RegExp('^##\\s+' + REF.source + '\\s*$', 'm'));
  return h ? h[1] : '';
}

/** 150-ish character description from the reflection (not the scripture quote or headings). */
function description(md, title, ref) {
  const paras = String(md).split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !/^#/.test(p) && !/^>/.test(p) && !/^["“]/.test(p));
  let text = strip(paras[0] || '');
  const lead = ref ? `${ref}: ` : '';
  let d = lead + text;
  if (d.length > 155) d = d.slice(0, 152).replace(/\s+\S*$/, '') + '…';
  if (d.length < 70) d = `${title}. A short Rock Solid Man devotional for men${ref ? ' on ' + ref : ''}: scripture, reflection and prayer.`.slice(0, 158);
  return d;
}

function load() {
  const posts = [];
  for (const f of fs.readdirSync(SRC).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8')); } catch (e) { console.warn('skip (not valid JSON):', f); continue; }
    const md = String(d.content_markdown || '');
    const date = String(d.date || f.slice(0, 10));
    const titleM = md.match(/^#\s+(.+)$/m);
    if (!titleM || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.warn('skip (no title/date):', f); continue; }
    const title = strip(titleM[1]).slice(0, 90);
    const ref = scriptureRef(md);
    const words = strip(md.replace(/^#.*$/gm, '')).split(' ').filter(Boolean).length;
    posts.push({ date, title, ref, md, words, description: description(md, title, ref), url: `/blog/${date}/` });
  }
  // AI-written titles repeat now and then; duplicate page titles hurt search, so repeats carry their date.
  const seen = {};
  posts.forEach((p) => { seen[p.title] = (seen[p.title] || 0) + 1; });
  posts.forEach((p) => { p.dupTitle = seen[p.title] > 1; });
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

/** Site header + footer from a live page, re-pointed for a page `depth` folders down. */
function chrome(depth) {
  const src = fs.readFileSync(TEMPLATE_PAGE, 'utf8');
  const start = src.indexOf('<a class="rsm-skip"'), mainAt = src.indexOf('<main id="main">');
  const fStart = src.indexOf('<footer class="rsm-footer">'), fEnd = src.indexOf('</footer>') + '</footer>'.length;
  if (start < 0 || mainAt < 0 || fStart < 0) throw new Error('Could not find the header/footer in ' + TEMPLATE_PAGE);
  const up = '../'.repeat(depth);
  const fix = (s) => s.replace(/ aria-current="page"/g, '')
    .replace(/(href|src)="(?!https?:|mailto:|#|\/)([^"]*)"/g, (m, a, u) => `${a}="${up}${u}"`)
    .replace(/(<li><a href=")[^"]*devotional\.html(")/, `$1${up}devotional.html" aria-current="page$2`);
  return { header: fix(src.slice(start, mainAt)), footer: fix(src.slice(fStart, fEnd)) };
}

const STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--stone); color: var(--cream); font-family: var(--ff-body); font-size: 17px; line-height: 1.75; -webkit-font-smoothing: antialiased; }
  .post { max-width: 720px; margin: 0 auto; padding: 0 1.5rem 5rem; }
  .post__meta { color: var(--text-muted); font-size: .85rem; letter-spacing: .06em; margin-bottom: 2rem; text-align: center; }
  .post h2 { font-family: var(--ff-display); font-weight: 400; letter-spacing: .04em; font-size: 1.7rem; color: var(--green-light); margin: 2.2rem 0 .6rem; }
  .post p { margin: 0 0 1.1rem; color: var(--cream-dark); }
  .post blockquote { border-left: 3px solid var(--copper); padding: .4rem 0 .4rem 1.1rem; margin: 0 0 1.2rem; font-family: var(--ff-serif); font-style: italic; color: var(--cream); }
  .post ul, .post ol { margin: 0 0 1.2rem 1.4rem; color: var(--cream-dark); }
  .post a { color: var(--green-light); }
  .post__nav { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--line); font-size: .92rem; }
  .post__nav a { text-decoration: none; max-width: 48%; }
  .post__cta { margin-top: 2.5rem; padding: 1.4rem 1.5rem; border: 1px solid var(--line-green); border-radius: 12px; background: rgba(45,90,59,.14); }
  .post__cta p { margin: 0 0 .9rem; }
  .arch { max-width: 900px; margin: 0 auto; padding: 0 1.5rem 5rem; }
  .arch h2 { font-family: var(--ff-display); font-weight: 400; letter-spacing: .05em; font-size: 1.6rem; margin: 2.4rem 0 .8rem; color: var(--copper-light); }
  .arch ul { list-style: none; display: grid; gap: .55rem; }
  .arch li a { display: flex; gap: 1rem; align-items: baseline; text-decoration: none; color: var(--cream); padding: .55rem .8rem; border-radius: 8px; border: 1px solid var(--line); }
  .arch li a:hover { border-color: var(--green-mid); }
  .arch time { color: var(--text-muted); font-size: .82rem; min-width: 5.5rem; }
  .arch .ref { color: var(--text-muted); font-family: var(--ff-serif); font-style: italic; font-size: .88rem; margin-left: auto; white-space: nowrap; }
  @media (max-width: 560px) { .arch li a { flex-wrap: wrap; } .arch .ref { margin-left: 0; } }
`;

function head({ title, desc, canonical, depth, extra }) {
  const up = '../'.repeat(depth);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}${canonical}">
<meta property="og:image" content="${SITE}/videos/posters/RSM_Promo_16x9.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/rss+xml" title="Rock Solid Man Daily Word" href="${SITE}/blog/feed.xml">
<link rel="icon" type="image/svg+xml" href="/assets/rsm-mark.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Playfair+Display:ital,wght@0,700;1,400&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${up}assets/site.css">
<style>${STYLE}</style>
${extra || ''}
</head>
<body>
`;
}

function postPage(p, prev, next, ch) {
  const ld = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.description,
    datePublished: p.date, dateModified: p.date, mainEntityOfPage: SITE + p.url, image: SITE + '/videos/posters/RSM_Promo_16x9.jpg',
    author: { '@type': 'Organization', name: 'Rock Solid Man', url: SITE + '/' },
    publisher: { '@type': 'Organization', name: 'Rock Solid Man', logo: { '@type': 'ImageObject', url: SITE + '/RSM_LOGO.png' } },
    isPartOf: { '@type': 'Blog', name: 'Rock Solid Man Daily Word', url: SITE + '/blog/' }, wordCount: p.words,
  };
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
    { '@type': 'ListItem', position: 2, name: 'Daily Word', item: SITE + '/blog/' },
    { '@type': 'ListItem', position: 3, name: p.title, item: SITE + p.url } ] };
  const short = new Date(p.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const name = p.dupTitle ? `${p.title} (${short})` : p.title;
  const title = (name + ' — Daily Word | Rock Solid Man').length <= 65 ? name + ' — Daily Word | Rock Solid Man' : (name + ' | Rock Solid Man').length <= 70 ? name + ' | Rock Solid Man' : name.slice(0, 70);
  return head({ title, desc: p.description, canonical: p.url, depth: 2,
    extra: `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n<script type="application/ld+json">${JSON.stringify(crumbs)}</script>` }) +
    ch.header + `<main id="main">
  <header class="rsm-page-hero">
    <span class="rsm-eyebrow">Daily Word</span>
    <h1>${esc(p.title)}</h1>
    ${p.ref ? `<p>${esc(p.ref)}</p>` : ''}
  </header>
  <article class="post">
    <p class="post__meta"><time datetime="${p.date}">${esc(fmtDate(p.date))}</time> · ${Math.max(1, Math.round(p.words / 200))} min read</p>
${markdown(p.md)}
    <div class="post__cta">
      <p>Get the Daily Word every morning in the free Rock Solid Man app, and join the brotherhood at our next gathering.</p>
      <a class="rsm-btn rsm-btn--green" href="../../events.html">See upcoming events</a>
      <a class="rsm-btn rsm-btn--ghost" href="../">More devotionals</a>
    </div>
    <nav class="post__nav" aria-label="More devotionals">
      ${next ? `<a href="../${next.date}/">← ${esc(next.title)}</a>` : '<span></span>'}
      ${prev ? `<a href="../${prev.date}/">${esc(prev.title)} →</a>` : '<span></span>'}
    </nav>
  </article>
</main>
` + ch.footer + `\n<script src="../../assets/site.js" defer></script>\n</body>\n</html>\n`;
}

function indexPage(posts, ch) {
  const byMonth = new Map();
  for (const p of posts) { const k = p.date.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(p); }
  const ld = { '@context': 'https://schema.org', '@type': 'Blog', name: 'Rock Solid Man Daily Word', url: SITE + '/blog/',
    description: 'Daily devotionals for men from Rock Solid Man.', publisher: { '@type': 'Organization', name: 'Rock Solid Man', url: SITE + '/' },
    blogPost: posts.slice(0, 20).map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: SITE + p.url, datePublished: p.date })) };
  let body = '';
  for (const [k, list] of byMonth) {
    body += `<h2>${esc(fmtMonth(k))}</h2>\n<ul>\n` + list.map((p) =>
      `<li><a href="${p.date}/"><time datetime="${p.date}">${esc(new Date(p.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))}</time><span>${esc(p.title)}</span>${p.ref ? `<span class="ref">${esc(p.ref)}</span>` : ''}</a></li>`).join('\n') + '\n</ul>\n';
  }
  return head({ title: 'Daily Word Devotionals for Men | Rock Solid Man',
    desc: 'Every Rock Solid Man Daily Word in one place: a scripture, a short reflection and a prayer for men, new every morning.', canonical: '/blog/', depth: 1,
    extra: `<script type="application/ld+json">${JSON.stringify(ld)}</script>` }) +
    ch.header + `<main id="main">
  <header class="rsm-page-hero">
    <span class="rsm-eyebrow">Daily Word</span>
    <h1>Devotionals for <em>men</em></h1>
    <p>A scripture, a short reflection and a prayer, new every morning. ${posts.length} devotionals and counting.</p>
  </header>
  <section class="arch">
${body}  </section>
</main>
` + ch.footer + `\n<script src="../assets/site.js" defer></script>\n</body>\n</html>\n`;
}

function feed(posts) {
  const items = posts.slice(0, 30).map((p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${SITE}${p.url}</link>
    <guid isPermaLink="true">${SITE}${p.url}</guid>
    <pubDate>${new Date(p.date + 'T10:00:00Z').toUTCString()}</pubDate>
    <description>${esc(p.description)}</description>
  </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Rock Solid Man Daily Word</title>
  <link>${SITE}/blog/</link>
  <description>Daily devotionals for men from Rock Solid Man.</description>
  <language>en-us</language>
${items}
</channel>
</rss>
`;
}

function updateSitemap(posts) {
  const file = path.join(ROOT, 'sitemap.xml');
  let xml = fs.readFileSync(file, 'utf8');
  const block = '  <!-- blog:start (generated by generate-blog.js) -->\n' +
    [{ loc: '/blog/', lastmod: posts[0] ? posts[0].date : '', freq: 'daily', pri: '0.7' }]
      .concat(posts.map((p) => ({ loc: p.url, lastmod: p.date, freq: 'yearly', pri: '0.5' })))
      .map((u) => `  <url>\n    <loc>${SITE}${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`).join('\n') +
    '\n  <!-- blog:end -->';
  if (/<!-- blog:start[\s\S]*?<!-- blog:end -->/.test(xml)) xml = xml.replace(/  <!-- blog:start[\s\S]*?<!-- blog:end -->/, block);
  else xml = xml.replace(/<\/urlset>\s*$/, block + '\n</urlset>\n');
  fs.writeFileSync(file, xml);
}

function main() {
  const posts = load();
  if (!posts.length) { console.log('No devotionals found.'); return; }
  const ch2 = chrome(2), ch1 = chrome(1);
  fs.mkdirSync(OUT, { recursive: true });
  const keep = new Set(posts.map((p) => p.date));
  for (const d of fs.readdirSync(OUT)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !keep.has(d)) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  posts.forEach((p, i) => {
    fs.mkdirSync(path.join(OUT, p.date), { recursive: true });
    fs.writeFileSync(path.join(OUT, p.date, 'index.html'), postPage(p, posts[i - 1], posts[i + 1], ch2));
  });
  fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(posts, ch1));
  fs.writeFileSync(path.join(OUT, 'posts.json'), JSON.stringify({ posts: posts.map((p) => ({ url: SITE + p.url, title: p.title, date: p.date, description: p.description, keywords: ['devotional', 'men', p.ref].filter(Boolean) })) }, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'feed.xml'), feed(posts));
  updateSitemap(posts);
  console.log(`Blog: ${posts.length} posts (latest ${posts[0].date}).`);
}

main();
