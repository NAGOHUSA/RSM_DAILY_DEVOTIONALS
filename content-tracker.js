// content-tracker.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ContentTracker {
  constructor() {
    this.trackerFile = path.join(__dirname, 'content_tracker.json');
    this.data = this.load();
  }

  load() {
    if (fs.existsSync(this.trackerFile)) {
      try { return JSON.parse(fs.readFileSync(this.trackerFile, 'utf8')); }
      catch { /* fall through */ }
    }
    return {
      titles: [],
      keyPhrases: [],
      scriptureReferences: [],
      themes: [],
      contentHashes: [],
      recentScriptures: [],
      lastUpdated: new Date().toISOString(),
      totalDevotionals: 0
    };
  }

  save() {
    this.data.lastUpdated = new Date().toISOString();
    this.data.totalDevotionals = this.data.titles.length;
    fs.writeFileSync(this.trackerFile, JSON.stringify(this.data, null, 2));
  }

  normalize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  sim(a, b) {
    const A = new Set(this.normalize(a).split(/\W+/).filter(w => w.length > 3));
    const B = new Set(this.normalize(b).split(/\W+/).filter(w => w.length > 3));
    const inter = [...A].filter(x => B.has(x)).length;
    const uni = new Set([...A, ...B]).size || 1;
    return inter / uni;
  }

  hash(text) {
    return crypto.createHash('sha1').update(this.normalize(text)).digest('hex');
  }

  isTitleUnique(newTitle, threshold = 0.7) {
    const n = this.normalize(newTitle);
    for (const t of this.data.titles) {
      const m = this.normalize(t.title);
      if (n === m) return { ok: false, reason: 'Exact title match', similar: t.title };
      if (this.sim(n, m) > threshold) return { ok: false, reason: 'Title too similar', similar: t.title };
    }
    return { ok: true };
  }

  isContentFresh(content) {
    const h = this.hash(content);
    const already = this.data.contentHashes.find(x => x.hash === h);
    if (already) return { ok: false, reason: 'Content body duplicated', similarDate: already.dateUsed };
    return { ok: true };
  }

  isScriptureFresh(reference, lookbackDays = 21) {
    if (!reference) return { ok: true };
    const cutoff = Date.now() - lookbackDays * 86400000;
    const recent = this.data.recentScriptures.filter(s => new Date(s.dateUsed).getTime() >= cutoff);
    const usedRecently = recent.find(s => this.normalize(s.reference) === this.normalize(reference));
    if (usedRecently) return { ok: false, reason: `Scripture used in last ${lookbackDays} days`, lastUsed: usedRecently.dateUsed };
    return { ok: true };
  }

  validate(devotional) {
    const t = this.isTitleUnique(devotional.title);
    if (!t.ok) return { ok: false, ...t };
    const c = this.isContentFresh(devotional.content);
    if (!c.ok) return { ok: false, ...c };
    const s = this.isScriptureFresh(devotional.scriptureReference);
    if (!s.ok) return { ok: false, ...s };
    return { ok: true };
  }

  record(devotional) {
    const date = devotional.date || new Date().toISOString().slice(0, 10);

    this.data.titles.push({ title: devotional.title, dateUsed: date, theme: devotional.theme || 'rock-solid' });
    this.data.contentHashes.push({ hash: this.hash(devotional.content), dateUsed: date });

    if (devotional.scriptureReference) {
      this.data.scriptureReferences.push({ reference: devotional.scriptureReference, dateUsed: date, theme: devotional.theme || 'rock-solid' });
      this.data.recentScriptures.push({ reference: devotional.scriptureReference, dateUsed: date });
      if (this.data.recentScriptures.length > 180) this.data.recentScriptures = this.data.recentScriptures.slice(-180);
    }

    if (devotional.theme) this.data.themes.push({ category: devotional.theme, dateUsed: date, title: devotional.title });

    this.save();
  }

  getRecentBlocklists() {
    return {
      titles: this.data.titles.slice(-10).map(t => t.title),
      scriptures: this.data.recentScriptures.slice(-30).map(s => s.reference)
    };
  }
}

module.exports = ContentTracker;
