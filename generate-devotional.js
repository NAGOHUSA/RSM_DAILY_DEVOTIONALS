// generate-devotional.js — multi-provider (DeepSeek → OpenRouter → Together), low-cost
// Node 18+ (global fetch). No external deps.

import fs from "node:fs/promises";
import path from "node:path";

// ---------- Provider order ----------
// Comma-separated list of providers to try in order.
const PROVIDERS = (process.env.DEVOTIONAL_PROVIDERS || "deepseek,openrouter,together")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// ---------- Common content controls ----------
const WORDS_MIN = Number(process.env.DEVOTIONAL_WORDS_MIN || 250);
const WORDS_MAX = Number(process.env.DEVOTIONAL_WORDS_MAX || 350);
const MAX_TOKENS = Number(process.env.DEVOTIONAL_MAX_TOKENS || 500);
const TEMPERATURE = Number(process.env.DEVOTIONAL_TEMPERATURE || 0.7);
const TIMEOUT_MS  = Number(process.env.DEVOTIONAL_TIMEOUT_MS  || 25000);
const MAX_ATTEMPTS_PER_PROVIDER = Number(process.env.DEVOTIONAL_MAX_ATTEMPTS || 2);
const THEME = process.env.DEVO_THEME || "";

// ---------- Provider config (fill only the ones you use) ----------
const DS = {
  apiKey: process.env.DEEPSEEK_API_KEY,
  model:  process.env.DEEPSEEK_MODEL || "deepseek-chat",
  url:    "https://api.deepseek.com/chat/completions",
};

const OR = {
  apiKey: process.env.OPENROUTER_API_KEY,                  // <— add this secret if you want fallback via OpenRouter
  // Use a low-cost, OpenAI-compatible model on OpenRouter (kept DeepSeek for similar style/cost)
  model:  process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat",
  url:    "https://openrouter.ai/api/v1/chat/completions",
};

const TG = {
  apiKey: process.env.TOGETHER_API_KEY,                    // <— add this secret for Together fallback
  model:  process.env.TOGETHER_MODEL || "deepseek-ai/DeepSeek-V3",
  url:    "https://api.together.xyz/v1/chat/completions",
};

// ---------- Prompt ----------
function devotionalMessages(dateISO) {
  const themeLine = THEME ? `Theme: ${THEME}\n` : "";
  return [
    {
      role: "system",
      content: [
        "You are a concise, pastoral devotional writer.",
        `Write ${WORDS_MIN}-${WORDS_MAX} words total, Markdown only (no HTML).`,
        "Sections in order:",
        "1) Title — ≤8 words.",
        "2) Scripture — exactly ONE verse/passage, ≤50 words quoted, include reference.",
        "3) Reflection — 150–220 words, practical and theologically sound.",
        "4) Prayer — 30–50 words, first-person plural (“we”).",
        "5) One-Line Application — one sentence, ≤12 words.",
        "No prefaces or duplicate sections.",
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Date: ${dateISO}`,
        themeLine,
        "Output using exactly these headers:",
        "# Title",
        "",
        "## Scripture",
        "",
        "## Reflection",
        "",
        "## Prayer",
        "",
        "## One-Line Application"
      ].join("\n")
    }
  ];
}

// ---------- Utils ----------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function wordCount(s) { return s ? s.trim().split(/\s+/).length : 0; }

async function postJSON(url, body, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function parseChatContent(jsonText) {
  try {
    const j = JSON.parse(jsonText);
    return (j.choices?.[0]?.message?.content || "").trim();
  } catch {
    return "";
  }
}

// ---------- Provider callers (all OpenAI-compatible) ----------
async function tryDeepSeek(messages) {
  if (!DS.apiKey) throw new Error("MISSING_KEY_DEEPSEEK");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
    const { ok, status, text } = await postJSON(
      DS.url,
      { model: DS.model, messages, temperature: TEMPERATURE, max_tokens: MAX_TOKENS },
      { Authorization: `Bearer ${DS.apiKey}` },
      TIMEOUT_MS
    );

    if (!ok) {
      if (status === 402) throw Object.assign(new Error("DS_402"), { code: "INSUFFICIENT_BALANCE" });
      if (status === 429 || status === 408 || (status >= 500 && status <= 599)) {
        if (attempt < MAX_ATTEMPTS_PER_PROVIDER) {
          const d = 900 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
          console.warn(`[DeepSeek] transient ${status}, retry in ${d}ms`);
          await sleep(d);
          continue;
        }
      }
      throw new Error(`[DeepSeek] error ${status}: ${text}`);
    }
    const content = parseChatContent(text);
    if (!content) throw new Error("[DeepSeek] empty content");
    return { provider: "deepseek", model: DS.model, content };
  }
  throw new Error("[DeepSeek] exhausted retries");
}

async function tryOpenRouter(messages) {
  if (!OR.apiKey) throw new Error("MISSING_KEY_OPENROUTER");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
    const { ok, status, text } = await postJSON(
      OR.url,
      { model: OR.model, messages, temperature: TEMPERATURE, max_tokens: MAX_TOKENS },
      {
        Authorization: `Bearer ${OR.apiKey}`,
        "HTTP-Referer": "https://github.com/",    // recommended headers
        "X-Title": "RSM_DAILY_DEVOTIONALS",
      },
      TIMEOUT_MS
    );

    if (!ok) {
      if (status === 402) throw Object.assign(new Error("OR_402"), { code: "INSUFFICIENT_BALANCE" });
      if (status === 429 || status === 408 || (status >= 500 && status <= 599)) {
        i
