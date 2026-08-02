// lib/gemini.js
// Turns raw "Hints & Surprises" text into gentle, brand-free hints
// using the Google Gemini API. Requires env var GEMINI_API_KEY.
// Supports automatic model fallback: if the primary model is rate-limited
// or unavailable, the next model in the list is tried automatically.
// "Exact Wishes" bypass this module entirely — they are never sent to AI.

const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-001"
];

const SYSTEM_PROMPT = `You transform a person's raw gift wishes into short gift HINTS in English.
You receive a single block of free text — one wish per line.

Rules:
- Rewrite each wish as a gentle, brand-free hint. Describe the TYPE of gift, never the exact product, brand or model.
- Keep sizes/quantities only if stated.
- Interests and hobbies become gentle directions ("something for …", "anything that …").
- Max 8 hints total. Merge duplicates. Skip empty lines.
- Each hint is ONE short line, no numbering, no emoji.
- Do not invent wishes that are not implied by the input.
- Output ONLY valid JSON, no markdown fences, in exactly this shape:
  { "hints": ["...", "..."] }`;

/**
 * Fail-safe: drop any hint that leaks a brand/model-looking token
 * from the raw wishes (tokens longer than 5 chars that are capitalised
 * or contain digits). Only applied to the AI-generated hints array.
 */
export function scrubHints(rawText, hints) {
  const rawTokens = new Set(
    String(rawText)
      .split(/[\s,.;]+/)
      .filter(t => t.length > 5 && (/[0-9]/.test(t) || /^[A-Z]/.test(t)))
      .map(t => t.toLowerCase())
  );
  return (Array.isArray(hints) ? hints : [])
    .map(h => String(h).trim())
    .filter(Boolean)
    .filter(h => ![...rawTokens].some(t => h.toLowerCase().includes(t)))
    .slice(0, 8);
}

/**
 * Legacy-compatible wrapper used by give-hint.js to scrub user-edited hints.
 * sections = { hints: "raw text", exact: "raw text" }
 * hintsObj = { hints: [...], exact: [...] }
 * Returns the scrubbed object — only the hints array is scrubbed, exact passes through.
 */
export function scrubAgainstRaw(sections, hintsObj) {
  return {
    hints: scrubHints(sections.hints || "", hintsObj.hints),
    exact: (Array.isArray(hintsObj.exact) ? hintsObj.exact : [])
      .map(h => String(h).trim())
      .filter(Boolean)
      .slice(0, 10)
  };
}

/**
 * Try a single Gemini model. Returns the parsed JSON on success,
 * or throws an error. Errors with status 404 or 429 are marked
 * as retryable so the caller can try the next model.
 */
async function tryModel(model, key, hintsText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: hintsText }] }],
      generationConfig: { temperature: 0.6, responseMimeType: "application/json" }
    })
  });

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
    throw new Error(`Gemini returned unparseable output (${model})`);
  }
}

/**
 * Mask the "Hints & Surprises" text through Gemini.
 * Returns an array of masked hint strings.
 * Exact wishes never pass through here.
 */
export async function maskWishes(hintsText) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const models = [...new Set(FALLBACK_MODELS)];
  let lastErr;

  for (const model of models) {
    try {
      console.log(`[gemini] trying ${model}…`);
      const parsed = await tryModel(model, key, hintsText);
      console.log(`[gemini] ${model} succeeded`);
      const arr = Array.isArray(parsed.hints) ? parsed.hints : [];
      return scrubHints(hintsText, arr);
    } catch (err) {
      console.warn(`[gemini] ${model} failed: ${err.message}`);
      lastErr = err;
      if (!err.retryable) throw err;
    }
  }

  throw lastErr;
}
