// generate-devotional.js
import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,          // set this in GitHub Secrets
  baseURL: "https://api.deepseek.com",           // <— point OpenAI SDK at DeepSeek
});

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat"; // or "deepseek-reasoner"

function devotionalPrompt({ dateISO, theme }) {
  return [
    {
      role: "system",
      content:
        "You are a Christian devotional writer. Write a daily devotional that ties a Bible passage to everyday life. Keep it theologically sound and warm, ~450–700 words. Include: Title, Scripture (with reference and quoted text), Reflection, Prayer, and a One-Line Application."
    },
    {
      role: "user",
      content:
        `Date: ${dateISO}\nTheme (optional): ${theme || "none"}\nConstraints: markdown sections with headings; no HTML; cite a single primary passage.\n`
    }
  ];
}

async function main() {
  const now = new Date();
  const dateISO = now.toISOString().slice(0, 10);

  const messages = devotionalPrompt({ dateISO, theme: process.env.DEVO_THEME });

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.8,
    max_tokens: 1200,
  });

  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("No content returned from DeepSeek.");

  const outDir = path.resolve("devotionals");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${dateISO}.md`);
  await fs.writeFile(outPath, text, "utf-8");

  console.log(`✅ Wrote ${outPath}`);
}

main().catch((err) => {
  console.error("❌ Generation failed:", err);
  process.exit(1);
});
