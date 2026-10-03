// lib/gemini.js
// Small Google Gemini helper: one JSON request with automatic model fallback.
// Requires env var GEMINI_API_KEY (with billing enabled — free-tier keys allow ~20 requests/model/day).
// Wishes are NOT sent to Gemini any more (the list is tidied in the browser); this is kept for the
// on-demand "gift ideas" feature, where the AI is only called when a giver asks for ideas.

const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash"
];

// Gemini 2.5+/3 models "think" before answering, which is most of the wait and most of the cost
// (thinking tokens are billed as output). Short structured answers need none: "minimal" measured
// ~0.2 cent and ~2 s per request vs ~0.8 cent and ~5 s with "low" (Oct 2026).
function thinkingConfigFor(model) {
  if (/^gemini-3/.test(model)) return { thinkingLevel: "minimal" };
  if (/^gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  return null;
}

async function tryModel(model, key, systemPrompt, userText, temperature, useThinkingConfig = true) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const generationConfig = { temperature, responseMimeType: "application/json" };
  const thinking = useThinkingConfig ? thinkingConfigFor(model) : null;
  if (thinking) generationConfig.thinkingConfig = thinking;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig
    })
  });

  // a model that doesn't accept this thinking setting → same model, without it
  if (res.status === 400 && thinking) {
    const body = await res.text();
    if (/thinking/i.test(body)) {
      console.warn(`[gemini] ${model} rejected thinkingConfig, retrying without it`);
      return tryModel(model, key, systemPrompt, userText, temperature, false);
    }
    const err = new Error(`Gemini API error 400 (${model}): ${body.slice(0, 300)}`);
    err.retryable = false;
    throw err;
  }

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Gemini API error ${res.status} (${model}): ${body.slice(0, 300)}`);
    err.retryable = res.status === 404 || res.status === 429 || res.status === 503;
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const clean = text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    const err = new Error(`Gemini returned unparseable output (${model})`);
    err.retryable = true;
    throw err;
  }
}

/* Group headings stay the English tag names ("Needs", "Wants" …) in every language for now —
   they become translatable when the site gets more languages. Older / translated labels are mapped back. */

/**
 * Ask Gemini for JSON. Tries the models in FALLBACK_MODELS in order on 404 / 429 / 503 or
 * unparseable output; any other error is thrown straight away.
 */
export async function askGemini(systemPrompt, userText, { temperature = 0.4 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  let lastErr;
  for (const model of [...new Set(FALLBACK_MODELS)]) {
    try {
      const started = Date.now();
      const json = await tryModel(model, key, systemPrompt, userText, temperature);
      console.log(`[gemini] ${model} answered in ${Date.now() - started} ms`);
      return json;
    } catch (err) {
      console.warn(`[gemini] ${model} failed: ${err.message}`);
      lastErr = err;
      if (!err.retryable) throw err;
    }
  }
  throw lastErr;
}
