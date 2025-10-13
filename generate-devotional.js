// generate-devotional.js — DeepSeek via fetch, no SDK needed (Node 18+)
import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const ENDPOINT = "https://api.deepseek.com/chat/completions";

function devotionalMessages(dateISO, theme) {
  return [
    {
      role: "system",
      content:
        "You are a Christian devotional writer. Write a daily devotional that ties a Bible passage to everyday life. Tone: warm, pastoral, theologically sound. 450–700 words. Sections: Title, Scripture (reference + quoted text), Reflection, Prayer, One-Line Application. Markdown only, no HTML."
    },
    {
      role: "user",
      content:
        `Date: ${dateISO}\nTheme (optional): ${theme || "none"}\nOutput strictly in Markdown with the sections requested.`
    }
  ];
}

async function callDeepSeek(messages) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.8,
      max_tokens: 1200,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${errText}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}

async function main() {
  if (!API_KEY) throw new Error("Missing DEEPSEEK_API_KEY");

  const now = new Date();
  const dateISO = now.toISOString().slice(0, 10);
  const messages = devotionalMessages(dateISO, process.env.DEVO_THEME);

  // Simple retry (up to 3 attempts with backoff)
  let content = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      content = await callDeepSeek(messages);
      if (content) break;
    } catch (e) {
      if (attempt === 3) throw e;
      const delayMs = 1000 * attempt ** 2;
      console.warn(`Retrying in ${delayMs}ms… (${attempt}/3)`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  if (!content) throw new Error("Empty response from DeepSeek");

  const outDir = path.resolve("devotionals");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${dateISO}.json`);
  const payload = {
    date: dateISO,
    model: MODEL,
    theme: process.env.DEVO_THEME || null,
    content_markdown: content,
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`✅ Wrote ${outPath}`);
}

main().catch(err => {
  console.error("❌ Generation failed:", err);
  process.exit(1);
});
