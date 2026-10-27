/* =====================================================================
   ROCK SOLID MAN — shared site behavior
   - Mobile menu toggle + header shadow on scroll
   - "Give" modal: any element with [data-give] opens it.
     Without JavaScript the same links go straight to CheddarUp.
   ===================================================================== */
(function () {
  'use strict';

  var GIVE_URL = 'https://my.cheddarup.com/c/help-men-find-faith-brotherhood-and-purpose/items';
  var PAYPAL_URL = 'https://www.paypal.com/donate/?hosted_button_id=T8NLD6Y9Z7AYG';
  var VENMO_URL = 'https://www.paypal.com/qrcodes/venmocs/35583249-8548-40b0-a609-de92029468d0?created=1729007121';

  // Site root, worked out from this script's own URL (assets/site.js),
  // so links inside the modal work from subfolders like /gallery/.
  var script = document.currentScript;
  var ROOT = script ? new URL('../', script.src).href : '/';

  window.RSM = window.RSM || {};
  window.RSM.GIVE_URL = GIVE_URL;
  window.RSM.root = ROOT;

  var HEART = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9.3C.4 8.6 2.3 4.5 6.2 4.5c2.2 0 3.6 1.2 4.4 2.4h2.8c.8-1.2 2.2-2.4 4.4-2.4 3.9 0 5.8 4.1 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>';
  var LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  /* ---------- Header ---------- */
  function initHeader() {
    var header = document.querySelector('.rsm-header');
    var btn = document.querySelector('.rsm-menu-btn');
    var nav = document.getElementById('rsm-nav');
    if (!header) return;

    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    if (!btn || !nav) return;
    var close = function () {
      nav.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Open menu');
    };
    btn.addEventListener('click', function () {
      var open = !nav.classList.contains('is-open');
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', function () { if (window.innerWidth > 1279) close(); });
  }

  /* ---------- Give modal ---------- */
  var modal, lastFocus;

  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'rsm-modal';
    modal.id = 'rsm-give-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'rsm-give-title');
    modal.innerHTML =
      '<div class="rsm-modal__box" role="document">' +
        '<button type="button" class="rsm-modal__close" aria-label="Close">&times;</button>' +
        '<p class="rsm-modal__eyebrow">Support the ministry</p>' +
        '<h2 class="rsm-modal__title" id="rsm-give-title">Help men find<br><em>faith, brotherhood</em><br>&amp; purpose</h2>' +
        '<p class="rsm-modal__text">Rock Solid Man is a nonprofit ministry. Every gift goes toward reaching men with the Gospel and building real brotherhood here at home.</p>' +
        '<p class="rsm-modal__text" style="margin-bottom:.6rem">Your gift supports:</p>' +
        '<ul class="rsm-modal__list">' +
          '<li>Monthly gatherings — worship, a message and fellowship</li>' +
          '<li>The Rock Solid Man podcast and daily devotionals</li>' +
          '<li>Reaching men who haven’t found their brotherhood yet</li>' +
        '</ul>' +
        '<a class="rsm-give-btn rsm-give-btn--lg" href="' + GIVE_URL + '" target="_blank" rel="noopener">' + HEART + 'Give on CheddarUp</a>' +
        '<p class="rsm-modal__secure">' + LOCK + 'Opens CheddarUp’s secure checkout in a new tab</p>' +
        '<div class="rsm-modal__alt"><span>Other ways to give:</span>' +
          '<a href="' + PAYPAL_URL + '" target="_blank" rel="noopener">PayPal</a>' +
          '<a href="' + VENMO_URL + '" target="_blank" rel="noopener">Venmo</a>' +
        '</div>' +
        '<p class="rsm-modal__fine">Rock Solid Man Inc · EIN 99-1099432 · <a href="' + ROOT + 'transparency.html">Transparency</a></p>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('.rsm-modal__close')) closeGive();
    });
    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeGive(); return; }
      if (e.key !== 'Tab') return;
      var f = modal.querySelectorAll('a[href], button');
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function openGive() {
    if (!modal) buildModal();
    lastFocus = document.activeElement;
    modal.classList.add('is-open');
    document.body.classList.add('rsm-lock');
    setTimeout(function () { var b = modal.querySelector('.rsm-give-btn'); if (b) b.focus(); }, 60);
  }

  function closeGive() {
    if (!modal) return;
    modal.classList.remove('is-open');
    document.body.classList.remove('rsm-lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  window.RSM.openGive = openGive;

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-give]');
    if (!trigger) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // let "open in new tab" work
    e.preventDefault();
    openGive();
  });

  // Deep link: any page URL ending in #give opens the modal.
  function checkHash() { if (location.hash === '#give') openGive(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initHeader(); checkHash(); });
  } else {
    initHeader(); checkHash();
  }

  /* =====================================================================
     DATA HELPERS — shared by the homepage, Daily Word and Watch pages
     ===================================================================== */
  var DEVO_BASE = 'https://raw.githubusercontent.com/NAGOHUSA/RSM_DAILY_DEVOTIONALS/main/devotionals/';
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Escapes, then allows simple *italic* / **bold** from the devotional markdown.
  function inline(str) {
    return esc(str).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }
  // "2026-10-27" -> local Date at midnight (new Date("2026-10-27") is UTC and shows the previous day in the US).
  function parseDay(s) {
    if (!s) return null;
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function fmtDate(d, opts) { return d.toLocaleDateString('en-US', opts || { weekday: 'short', month: 'short', day: 'numeric' }); }
  function ago(d) {
    var days = Math.round((today() - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    return fmtDate(d, { month: 'short', day: 'numeric' });
  }
  function getJSON(path) {
    var url = /^https?:/.test(path) ? path : ROOT + path;
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  /* ---------- Events ---------- */
  function loadEvents() {
    return getJSON('calendar-events.json').then(function (data) {
      var t = today();
      return (data.events || [])
        .map(function (e) { e._date = parseDay(e.date); return e; })
        .filter(function (e) { return e._date && e._date >= t; })
        .sort(function (a, b) { return a._date - b._date; });
    });
  }

  /* ---------- Devotional ---------- */
  // Handles both formats the generator has produced:
  //   "## Scripture\n“quote” — Ref"   and   "## Matthew 14:22\n“quote”\n(Ref, NIV)"
  function parseDevotional(md) {
    var out = { title: '', ref: '', quote: '', reflection: [], prayer: '', application: '' };
    if (!md) return out;
    var t = md.match(/^#\s+(.+)$/m);
    out.title = t ? t[1].trim() : 'Daily Word';
    var parts = md.split(/^##\s+/m).slice(1);
    parts.forEach(function (part) {
      var nl = part.indexOf('\n');
      var heading = (nl === -1 ? part : part.slice(0, nl)).trim();
      var body = (nl === -1 ? '' : part.slice(nl + 1)).trim();
      if (/^reflection/i.test(heading)) {
        out.reflection = body.split(/\n\s*\n/).map(function (p) { return p.replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean);
      } else if (/^prayer/i.test(heading)) {
        out.prayer = body.replace(/\s+/g, ' ').trim();
      } else if (/application/i.test(heading)) {
        out.application = body.replace(/\s+/g, ' ').trim();
      } else if (!out.quote) {
        var ref = /^scripture/i.test(heading) ? '' : heading;
        var s = body;
        var paren = s.match(/\n\s*\(([^)]+)\)\s*$/);
        if (paren) { ref = paren[1].trim(); s = s.slice(0, paren.index); }
        var dash = s.match(/^([\s\S]*)\s+(?:—|–|--?)\s+([^\n—]+)$/);
        if (dash) { s = dash[1]; ref = dash[2].trim(); }
        out.ref = ref;
        out.quote = s.replace(/\s+/g, ' ').trim().replace(/^["“]+|["”]+$/g, '');
      }
    });
    return out;
  }

  function loadDevotional(dateStr) {
    var key = 'rsm_devo_' + dateStr;
    var cached = store(key);
    if (cached) return Promise.resolve(cached);
    return getJSON(DEVO_BASE + dateStr + '.json').then(function (data) {
      var d = parseDevotional(data.content_markdown);
      d.date = dateStr;
      store(key, d);
      return d;
    });
  }

  // Today's devotional, or the most recent one in the last `back` days.
  function loadLatestDevotional(back) {
    back = back || 7;
    var i = 0;
    function attempt() {
      var d = today(); d.setDate(d.getDate() - i);
      return loadDevotional(ymd(d)).catch(function () {
        i++;
        if (i > back) throw new Error('No recent devotional found');
        return attempt();
      });
    }
    return attempt();
  }

  /* ---------- Videos ---------- */
  function loadVideos() {
    return getJSON('videos/videos.json').then(function (data) {
      var list = (data.videos || []).slice().sort(function (a, b) {
        if (!!b.featured !== !!a.featured) return b.featured ? 1 : -1;
        return (parseDay(b.date) || 0) - (parseDay(a.date) || 0);
      });
      return { youtube: data.youtube, videos: list };
    });
  }

  /* ---------- Click-to-play video ----------
     Shows only the poster image until tapped, so pages stay fast.
     Videos stream (they're encoded with the index up front). */
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';
  function player(v) {
    var vertical = v.format === 'vertical';
    return '<div class="rsm-player' + (vertical ? ' rsm-player--vertical' : '') + '" data-file="' + esc(v.file) + '" data-poster="' + esc(v.poster || '') + '">' +
      '<button type="button" class="rsm-player__btn" aria-label="Play video: ' + esc(v.title) + (v.duration ? ' (' + esc(v.duration) + ')' : '') + '">' +
        (v.poster ? '<img src="' + esc(ROOT + v.poster) + '" alt="" loading="lazy" decoding="async">' : '') +
        '<span class="rsm-player__play">' + PLAY + '</span>' +
        (v.duration ? '<span class="rsm-player__dur">' + esc(v.duration) + '</span>' : '') +
      '</button></div>';
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.rsm-player__btn');
    if (!btn) return;
    var wrap = btn.parentElement;
    var video = document.createElement('video');
    video.src = ROOT + wrap.getAttribute('data-file');
    if (wrap.getAttribute('data-poster')) video.poster = ROOT + wrap.getAttribute('data-poster');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    wrap.innerHTML = '';
    wrap.appendChild(video);
    wrap.classList.add('is-playing');
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  });
  // Only one video plays at a time.
  document.addEventListener('play', function (e) {
    if (e.target.tagName !== 'VIDEO') return;
    document.querySelectorAll('video').forEach(function (v) { if (v !== e.target) v.pause(); });
  }, true);

  window.RSM.player = player;
  window.RSM.esc = esc;
  window.RSM.inline = inline;
  window.RSM.parseDay = parseDay;
  window.RSM.ymd = ymd;
  window.RSM.today = today;
  window.RSM.fmtDate = fmtDate;
  window.RSM.ago = ago;
  window.RSM.getJSON = getJSON;
  window.RSM.MONTHS = MONTHS;
  window.RSM.DAYS = DAYS;
  window.RSM.loadEvents = loadEvents;
  window.RSM.parseDevotional = parseDevotional;
  window.RSM.loadDevotional = loadDevotional;
  window.RSM.loadLatestDevotional = loadLatestDevotional;
  window.RSM.loadVideos = loadVideos;
})();
