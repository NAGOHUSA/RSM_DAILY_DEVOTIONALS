// generate-devotional.js — DeepSeek (low-cost daily)
// Node 18+ required (global fetch). No external deps.

import fs from "node:fs/promises";
import path from "node:path";

// ---------- Config (env overrides supported) ----------
const API_KEY   = process.env.DEEPSEEK_API_KEY;
const MODEL     = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const ENDPOINT  = "https://api.deepseek.com/chat/completions";

// Cost controls (tune via env if needed)
const MAX_TOKENS   = Number(process.env.DEVOTIONAL_MAX_TOKENS || 500); // hard cap
const TEMPERATURE  = Number(process.env.DEVOTIONAL_TEMPERATURE || 0.7);
const TIMEOUT_MS   = Number(process.env.DEVOTIONAL_TIMEOUT_MS || 25000);
const MAX_ATTEMPTS = Number(process.env.DEVOTIONAL_MAX_ATTEMPTS || 3);

// Content size targets (soft limits enforced in prompt)
const TARGET_WORDS_MIN = Number(process.env.DEVOTIONAL_WORDS_MIN || 250);
const TARGET_WORDS_MAX = Number(process.env.DEVOTIONAL_WORDS_MAX || 350);

// Optional theme seed (leave empty for variety)
const THEME = process.env.DEVO_THEME || "";

// ------------------------------------------------------

function devotionalMessages(dateISO) {
  const themeLine = THEME ? `Theme: ${THEME}\n` : "";
  const system = [
    "You are a concise, pastoral devotional writer.",
    `Overall length target: ${TARGET_WORDS_MIN}-${TARGET_WORDS_MAX} words total.`,
    "Use Markdown. Keep language simple and warm.",
    "Sections and constraints:",
    "1) Title — ≤8 words.",
    "2) Scripture — exactly ONE verse or passage, ≤50 words quoted; include reference.",
    "3) Reflection — 150–220 words, practical and theologically sound.",
    "4) Prayer — 30–50 words, first-person plural (“we”).",
    "5) One-Line Application — 1 sentence, ≤12 words.",
    "No extra prefaces or explanations. No HTML. No duplicate sections.",
  ].join(" ");

  const user = [
    `Date: ${dateISO}`,
    themeLine,
    "Output format (exact headers):",
    "# Title",
    "",
    "## Scripture",
    "",
    "## Reflection",
    "",
    "## Prayer",
    "",
    "## One-Line Application",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user",   content: user }
  ];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callDeepSeek(messages) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      // Gracefully skip when out of balance
      if (res.status === 402) {
        const err = new Error(`Insufficient balance (402): ${body}`);
        err.code = "INSUFFICIENT_BALANCE";
        throw err;
      }
      // Retryable statuses
      if (res.status === 408 || res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        const err = new Error(`Transient DeepSeek error ${res.status}: ${body}`);
        err.code = "RETRYABLE";
        throw err;
      }
      throw new Error(`DeepSeek API error ${res.status}: ${body}`);
    }

    const json = await res.json();
    return (json.choices?.[0]?.message?.content || "").trim();
  } finally {
    clearTimeout(t);
  }
}

function wordCount(s) {
  return s ? s.trim().split(/\s+/).length : 0;
}

async function main() {
  if (!API_KEY) throw new Error("Missing DEEPSEEK_API_KEY environment variable.");

  const now = new Date();
  const dateISO = now.toISOString().slice(0, 10);

  const messages = devotionalMessages(dateISO);

  // Exponential backoff with small jitter for retryable errors
  let content = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      content = await callDeepSeek(messages);
      if (content) break;
      throw new Error("Empty response from DeepSeek");
    } catch (err) {
      if (err.code === "INSUFFICIENT_BALANCE") {
        console.warn("⚠️ DeepSeek balance is insufficient. Skipping generation today.");
        // Exit 0 so workflow stays green without committing anything.
        process.exit(0);
      }
      if (attempt >= MAX_ATTEMPTS) throw err;
      const delayMs = 800 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 300);
      console.warn(`Retry ${attempt}/${MAX_ATTEMPTS - 1} after ${delayMs}ms… (${err.message})`);
      await sleep(delayMs);
    }
  }

  // Final sanity clamp to keep cost low if the model overshoots
  const words = wordCount(content);
  if (!content || words < 120) {
    throw new Error(`Unexpectedly short content (${words} words).`);
  }

  const outDir = path.resolve("devotionals");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${dateISO}.json`);

  const payload = {
    date: dateISO,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    words: words,
    theme: THEME || null,
    content_markdown: content,
    meta: {
      version: "low-cost-ds-1",
      constraints: {
        scripture_quote_words_max: 50,
        total_words_target: [TARGET_WORDS_MIN, TARGET_WORDS_MAX],
      }
    }
  };

  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`✅ Wrote ${outPath} (${words} words)`);
}

main().catch((err) => {
  console.error("❌ Generation failed:", err);
  process.exit(1);
});
