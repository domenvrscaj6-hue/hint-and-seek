// lib/gemini.js
// Turns raw wishes (needs / wants / likes) into gentle, brand-free hints
// using the Google Gemini API. Requires env var GEMINI_API_KEY.
// Supports automatic model fallback: if the primary model is rate-limited
// or unavailable, the next model in the list is tried automatically.

const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-001"
];

const SYSTEM_PROMPT = `You transform a person's raw gift wishes into short gift HINTS in English.
You receive JSON: { "needs": "...", "wants": "...", "likes": "..." } — free text, one wish per line, some fields may be empty.

Rules per section:
- "needs": practical items. Rewrite each as a practical, actionable hint. NEVER reveal brand or model. Keep sizes/quantities only if stated.
- "wants": describe the TYPE of gift, never the exact product, brand or model. One line each, warm tone.
- "likes": these are interests/hobbies. Turn them into gentle gift directions ("something for ...", "anything that ..."). No products, no brands.

General rules:
- Max 6 hints per section. Merge duplicates. Skip empty lines.
- Each hint is ONE short line, no numbering, no emoji.
- Do not invent wishes that are not implied by the input.
- If a section input is empty, return an empty array for it.
- Output ONLY valid JSON, no markdown fences, in exactly this shape:
  { "needs": ["..."], "wants": ["..."], "likes": ["..."] }`;

/**
 * Fail-safe used on Gemini output AND on user-edited hints before sending:
 * drop any hint that leaks a brand/model-looking token from the raw wishes
 * (tokens longer than 5 chars that are capitalised or contain digits).
 */
export function scrubAgainstRaw(sections, hints) {
  const rawTokens = new Set(
    Object.values(sections).join("\n")
      .split(/[\s,.;]+/)
      .filter(t => t.length > 5 && (/[0-9]/.test(t) || /^[A-Z]/.test(t)))
      .map(t => t.toLowerCase())
  );
  const scrub = arr => (Array.isArray(arr) ? arr : [])
    .map(h => String(h).trim())
    .filter(Boolean)
    .filter(h => ![...rawTokens].some(t => h.toLowerCase().includes(t)))
    .slice(0, 6);

  return {
    needs: scrub(hints.needs),
    wants: scrub(hints.wants),
    likes: scrub(hints.likes)
  };
}

/**
 * Try a single Gemini model. Returns the parsed JSON on success,
 * or throws an error. Errors with status 404 or 429 are marked
 * as retryable so the caller can try the next model.
 */
async function tryModel(model, key, sections) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(sections) }] }],
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

export async function maskWishes(sections) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  // Remove duplicates (env var model might match a fallback)
  const models = [...new Set(FALLBACK_MODELS)];
  let lastErr;

  for (const model of models) {
    try {
      console.log(`[gemini] trying ${model}…`);
      const parsed = await tryModel(model, key, sections);
      console.log(`[gemini] ${model} succeeded`);
      return scrubAgainstRaw(sections, parsed);
    } catch (err) {
      console.warn(`[gemini] ${model} failed: ${err.message}`);
      lastErr = err;
      if (!err.retryable) throw err; // non-retryable error → stop immediately
    }
  }

  throw lastErr; // all models exhausted
}
