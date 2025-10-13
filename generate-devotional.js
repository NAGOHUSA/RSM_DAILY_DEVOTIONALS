// generate-devotional.js
const fs = require('fs');
const path = require('path');
const ContentTracker = require('./content-tracker');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

const DEVOTIONALS_DIR = path.join(__dirname, 'devotionals');
if (!fs.existsSync(DEVOTIONALS_DIR)) fs.mkdirSync(DEVOTIONALS_DIR, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const outFile = path.join(DEVOTIONALS_DIR, `${today}.json`);
if (fs.existsSync(outFile)) {
  console.log(`✅ Devotional for ${today} already exists. Exiting.`);
  process.exit(0);
}

function buildSystemPrompt(block) {
  const avoidTitles = block?.titles?.length ? `Avoid titles similar to: ${block.titles.join('; ')}.` : '';
  const avoidScriptures = block?.scriptures?.length ? `Avoid these scripture references used recently: ${block.scriptures.join('; ')}.` : '';

  return `You are a seasoned Christian men's devotional author for an app called "Rock Solid Man".
Audience: strong Christian men pursuing daily faithfulness with humility and grit.
Voice: encouraging, direct, practical; brother-to-brother. Tone: uplifting, courageous, grounded in Scripture.

Write a fresh daily devotional with:
- Distinct, non-repeating TITLE.
- One SCRIPTURE REFERENCE not used in the last 21 days.
- A 230–380 word REFLECTION with concrete imagery (avoid clichés), calling men to steady obedience.
- 2–3 REFLECTION QUESTIONS (action and integrity focused).
- A one-sentence PRAYER.
- A short THEME tag (e.g., "integrity", "courage", "servant leadership").

${avoidTitles}
${avoidScriptures}

Return ONLY valid JSON with keys:
title, scriptureReference, content, questions (array), prayer, theme.`;
}

async function callOpenAI(system, user) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.9,
      presence_penalty: 0.6,
      frequency_penalty: 0.6,
      max_tokens: 900
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

function cleanup(s) {
  return String(s || '').replace(/\n{3,}/g, '\n\n').trim();
}

(async () => {
  const tracker = new ContentTracker();
  const block = tracker.getRecentBlocklists();

  let system = buildSystemPrompt(block);
  const user = `Date: ${today}. Create today's Rock Solid Man devotional now.`;

  const MAX_TRIES = 5;
  let attempt = 0;
  let final = null;
  let lastReason = '';

  while (attempt < MAX_TRIES) {
    attempt++;
    console.log(`🛠 Generating (attempt ${attempt}/${MAX_TRIES})...`);
    const draft = await callOpenAI(system, user);

    const candidate = {
      date: today,
      title: cleanup(draft.title),
      scriptureReference: cleanup(draft.scriptureReference),
      content: cleanup(draft.content),
      questions: Array.isArray(draft.questions) ? draft.questions : [],
      prayer: cleanup(draft.prayer),
      theme: cleanup(draft.theme || 'rock-solid')
    };

    const check = tracker.validate(candidate);
    if (check.ok) {
      final = candidate;
      break;
    } else {
      lastReason = check.reason || 'similarity';
      system = buildSystemPrompt({
        titles: [...block.titles, candidate.title].slice(-15),
        scriptures: [...block.scriptures, candidate.scriptureReference].slice(-45)
      }) + `\n\nAdditional constraint from last attempt: ${lastReason}. Produce a distinctly different title and passage.`;
    }
  }

  if (!final) {
    console.warn('⚠️ Fallback: enforce uniqueness by suffixing date to title.');
    const fb = await callOpenAI(buildSystemPrompt(block), user);
    final = {
      date: today,
      title: `${cleanup(fb.title)} — ${today}`,
      scriptureReference: cleanup(fb.scriptureReference),
      content: cleanup(fb.content),
      questions: Array.isArray(fb.questions) ? fb.questions : [],
      prayer: cleanup(fb.prayer),
      theme: cleanup(fb.theme || 'rock-solid')
    };
  }

  const output = {
    id: `devotional-${today}`,
    date: today,
    title: final.title,
    content: final.content,
    scriptureReference: final.scriptureReference,
    celestialConnection: "Build on the Rock: unshakable character formed by daily obedience.",
    theme: final.theme,
    moonPhase: "",
    moonIllumination: "",
    visiblePlanets: "",
    specialEvents: "",
    questions: final.questions,
    prayer: final.prayer
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8');
  tracker.record(final);
  console.log(`✅ Wrote ${outFile}`);
})().catch(err => {
  console.error('💥 Fatal error:', err.message || err);
  process.exit(1);
});
