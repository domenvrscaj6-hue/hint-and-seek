// lib/gemini.js
// Turns the raw wishes into gentle, brand-free hints
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
You receive a single block of free text — one wish per line.

Rules:
- Rewrite each wish as a gentle, brand-free hint. Describe the TYPE of gift, never the exact product, brand or model.
- Never mention a brand, product line, model name/number, shop, book/film/game title or author — not even in lowercase.
- Keep sizes/quantities only if stated.
- Interests and hobbies become gentle directions ("something for …", "anything that …").
- Max 8 hints total. Merge duplicates. Skip empty lines.
- Each hint is ONE short line, no numbering, no emoji.
- Do not invent wishes that are not implied by the input.
- In "brands", list EVERY brand, product line, model name/number, shop, title and author name that appears
  in the input, exactly as written (e.g. "Sony", "WH-1000XM5", "lego", "Harry Potter"). Empty list if none.
- Output ONLY valid JSON, no markdown fences, in exactly this shape:
  { "hints": ["...", "..."], "brands": ["...", "..."] }`;

// Capitalised words that are normal English, not brands — never treated as leaks.
const COMMON_CAPS = new Set((
  "i a an the and or for with of in on at to my me our your his her their this that " +
  "christmas xmas easter halloween birthday new year valentine valentines mothers fathers " +
  "january february march april may june july august september october november december " +
  "monday tuesday wednesday thursday friday saturday sunday " +
  "english french german italian spanish japanese chinese korean " +
  "europe european america american asia asian africa african " +
  "tv pc diy usb led hd xs s m l xl xxl xxxl eu us uk ok cd dvd vr ai"
).split(" "));

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Words in the raw wishes that look like a brand, model or title:
 *  - letters mixed with digits        (PS5, WH-1000XM5)
 *  - a capital inside the word        (iPhone, AirPods, PlayStation)
 *  - ALL CAPS, 2+ letters             (JBL, IKEA)
 *  - Capitalised NOT at the start of a line/sentence (… by Aldous Huxley)
 * Plain numbers (sizes, quantities) and ordinary words are allowed.
 */
export function brandLikeTokens(rawText) {
  const out = new Set();
  for (const line of String(rawText || "").split("\n")) {
    // split into sentences, then words; keep inner hyphens/apostrophes (WH-1000XM5, McDonald's)
    for (const sentence of line.split(/[.!?;:]\s+/)) {
      const words = sentence.split(/[\s,()"“”]+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
      words.forEach((w, i) => {
        const lower = w.toLowerCase();
        if (COMMON_CAPS.has(lower)) return;
        const hasLetter = /\p{L}/u.test(w), hasDigit = /\p{N}/u.test(w);
        if (hasLetter && hasDigit) out.add(lower);
        else if (/\p{Ll}\p{Lu}/u.test(w)) out.add(lower);
        else if (w.length >= 2 && /^\p{Lu}+$/u.test(w)) out.add(lower);
        else if (i > 0 && w.length >= 3 && /^\p{Lu}/u.test(w)) out.add(lower);
        // also the parts of hyphenated model names (WH-1000XM5 → 1000xm5)
        if (hasLetter && hasDigit && w.includes("-")) {
          w.split("-").filter(p => p.length >= 2 && /\p{N}/u.test(p) && /\p{L}/u.test(p)).forEach(p => out.add(p.toLowerCase()));
        }
      });
    }
  }
  return out;
}

/** Normalises a brand list (from Gemini / the client) into lowercase tokens. */
function brandListTokens(brands) {
  const out = new Set();
  (Array.isArray(brands) ? brands : []).slice(0, 50).forEach(b => {
    const t = String(b || "").trim().toLowerCase().slice(0, 60);
    if (t.length >= 2 && !COMMON_CAPS.has(t)) out.add(t);
  });
  return out;
}

/**
 * Returns the leaked token found in `hint`, or null. Whole-word match only
 * ("lego" matches "Lego" / "legos", not "allegory").
 */
function findLeak(hint, tokens) {
  for (const t of tokens) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t)}s?(?=$|[^\\p{L}\\p{N}])`, "iu");
    if (re.test(hint)) return t;
  }
  return null;
}

/**
 * Fail-safe check of hints against the raw wishes.
 * `brands` = brand list Gemini extracted from the raw text (catches lowercase / sentence-start brands
 * the heuristic can't see). Returns { clean: [...], leaks: [{ hint, word }] }.
 */
export function checkHints(rawText, hints, brands) {
  const tokens = new Set([...brandLikeTokens(rawText), ...brandListTokens(brands)]);
  const clean = [], leaks = [];
  (Array.isArray(hints) ? hints : [])
    .map(h => String(h).trim())
    .filter(Boolean)
    .forEach(h => {
      const word = findLeak(h, tokens);
      if (word) leaks.push({ hint: h, word });
      else clean.push(h);
    });
  return { clean: clean.slice(0, 8), leaks };
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
    const err = new Error(`Gemini returned unparseable output (${model})`);
    err.retryable = true;
    throw err;
  }
}

/**
 * Mask the wishes text through Gemini.
 * Returns { hints: [...masked, already leak-checked], brands: [...] }.
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
      const brands = Array.isArray(parsed.brands) ? parsed.brands.map(String).slice(0, 50) : [];
      const { clean } = checkHints(hintsText, parsed.hints, brands);
      return { hints: clean, brands };
    } catch (err) {
      console.warn(`[gemini] ${model} failed: ${err.message}`);
      lastErr = err;
      if (!err.retryable) throw err;
    }
  }

  throw lastErr;
}
