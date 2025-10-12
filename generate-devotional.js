// generate-devotional.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ContentTracker = require('./content-tracker');

// ENV
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FORCE_REGENERATE = process.env.FORCE_REGENERATE === 'true';

// Output dir
const DEVOTIONALS_DIR = path.join(__dirname, 'devotionals');
if (!fs.existsSync(DEVOTIONALS_DIR)) fs.mkdirSync(DEVOTIONALS_DIR, { recursive: true });

// Today
const todayISO = new Date().toISOString().slice(0, 10);
const outPath = path.join(DEVOTIONALS_DIR, `${todayISO}.json`);

// Skip if exists (unless force)
if (fs.existsSync(outPath) && !FORCE_REGENERATE) {
  console.log(`✅ Devotional for ${todayISO} already exists. Use FORCE_REGENERATE=true to overwrite.`);
  process.exit(0);
}

// Helpers
function md(content) {
  return content.replace(/\n{3,}/g, '\n\n').trim();
}

// Build system prompt tailored to "Rock Solid Man"
function buildSystemPrompt(block) {
  const avoidTitles = block?.titles?.length ? `Avoid titles similar to: ${block.titles.join('; ')}.` : '';
  const avoidScriptures = block?.scriptures?.length ? `Avoid these scripture references (used recently): ${block.scriptures.join('; ')}.` : '';

  return `You are a seasoned Christian men's devotional author for an app called "Rock Solid Man".
Audience: strong Christian men—fathers, husbands, brothers, leaders—who pursue daily faithfulness with humility and grit.
Voice: encouraging, direct, practical, brother-to-brother. Tone: uplifting, courageous, grounded in Scripture. Imagery: rock, steel, foundation, integrity, service, leadership, courage, endurance.

Write a fresh daily devotional with:
- A distinct, non-repeating TITLE for the day.
- One SCRIPTURE REFERENCE not used in the last 21 days.
- A 230–380 word REFLECTION that is specific and concrete (no clichés), calling men to steady obedience.
- 2–3 REFLECTION QUESTIONS focused on action and integrity.
- A one-sentence PRAYER.
- A short THEME tag (e.g., "integrity", "courage", "servant leadership").

${avoidTitles}
${avoidScriptures}

Return ONLY valid JSON with keys:
title, scriptureReference, content, questions (array), prayer, theme.`;
}

// OpenAI call
async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.9,
    presence_penalty: 0.6,
    frequency_penalty: 0.6,
    max_tokens: 900
  }, {
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  return JSON.parse(resp.data.choices[0].message.content);
}

// Main
(async () => {
  const tracker = new ContentTracker();
  const usage = tracker.getUsageReport();
  const recentTitles = usage.recentActivity.lastWeekTitles || [];
  const recentScriptures = usage.recentActivity.lastScriptures || [];

  let system = buildSystemPrompt({ titles: recentTitles, scriptures: recentScriptures });
  const user = `Date: ${todayISO}. Create today's Rock Solid Man devotional now.`;

  const MAX_TRIES = 5;
  let attempt = 0;
  let result = null;
  let lastReason = null;

  while (attempt < MAX_TRIES) {
    attempt++;
    console.log(`🛠  Generating (attempt ${attempt}/${MAX_TRIES})...`);
    const draft = await callOpenAI({ system, user });

    const candidate = {
      date: todayISO,
      title: (draft.title || '').trim(),
      scriptureReference: (draft.scriptureReference || '').trim(),
      content: md(draft.content || ''),
      questions: Array.isArray(draft.questions) ? draft.questions : [],
      prayer: (draft.prayer || '').trim(),
      theme: (draft.theme || 'rock-solid').trim()
    };

    const check = tracker.validate(candidate);
    if (check.ok) {
      result = candidate;
      break;
    } else {
      lastReason = check.reason || 'unknown';
      // tighten constraints
      system = buildSystemPrompt({
        titles: [...recentTitles, candidate.title].slice(-15),
        scriptures: [...recentScriptures, candidate.scriptureReference].slice(-45)
      }) + `\n\nAdditional constraint: ${lastReason}. Produce a distinctly different title and passage.`;
    }
  }

  if (!result) {
    console.warn('⚠️  Falling back with date-suffixed title for guaranteed uniqueness.');
    const fallback = await callOpenAI({ system: buildSystemPrompt({ titles: recentTitles, scriptures: recentScriptures }), user });
    result = {
      date: todayISO,
      title: `${(fallback.title || 'Rock Solid Man').trim()} — ${todayISO}`,
      scriptureReference: (fallback.scriptureReference || '').trim(),
      content: md(fallback.content || ''),
      questions: Array.isArray(fallback.questions) ? fallback.questions : [],
      prayer: (fallback.prayer || '').trim(),
      theme: (fallback.theme || 'rock-solid').trim()
    };
  }

  // Preserve general output structure with optional celestial placeholders
  const devotional = {
    id: `devotional-${todayISO}`,
    date: todayISO,
    title: result.title,
    content: result.content,
    scriptureReference: result.scriptureReference,
    celestialConnection: "Build on the Rock: unshakable character formed by daily obedience.",
    theme: result.theme,
    moonPhase: "",
    moonIllumination: "",
    visiblePlanets: "",
    specialEvents: "",
    questions: result.questions,
    prayer: result.prayer
  };

  // Write file then record in tracker (so only successful outputs are tracked)
  fs.mkdirSync(DEVOTIONALS_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(devotional, null, 2));
  const recordPayload = {
    date: devotional.date,
    title: devotional.title,
    scriptureReference: devotional.scriptureReference,
    content: devotional.content,
    theme: devotional.theme
  };
  const tracker2 = new ContentTracker();
  tracker2.record(recordPayload);

  console.log('✅ Rock Solid Man devotional generated');
  console.log(`📖 Title: ${devotional.title}`);
  console.log(`📜 Scripture: ${devotional.scriptureReference}`);
  console.log(`💾 Saved: ${outPath}`);
})().catch(err => {
  console.error('💥 Fatal error:', err?.response?.data || err.message || err);
  process.exit(1);
});

