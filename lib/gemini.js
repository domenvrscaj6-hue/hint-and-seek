// lib/gemini.js
// Turns the raw wishes into gentle hints — nudges toward an area, never the exact item
// using the Google Gemini API. Requires env var GEMINI_API_KEY.
// Supports automatic model fallback: if the primary model is rate-limited
// or unavailable, the next model in the list is tried automatically.

const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-001"
];

const SYSTEM_PROMPT = `You turn a person's raw gift wishes into short gift HINTS in English.
You receive a single block of free text — one wish per line.

A hint is a nudge, not a disguised shopping list. It points the gift-giver toward the right
AREA of the person's life (an activity, a moment, a need, a feeling, a place) and leaves the
actual choice — and the little "aha!" — to them. Someone reading the hint should have to think
and imagine a few possible gifts, all of which would make the person happy.

Rules:
- Never name the wished item itself or its obvious category ("running shoes", "socks",
  "speaker", "headphones", "e-reader", "candy", "perfume"…). Hint at what it is FOR or
  when it is enjoyed instead.
- Never mention a brand, product line, model name/number, shop, book/film/game title or
  author — not even in lowercase.
- Removing the brand is NOT enough: "a portable speaker" for "JBL Boombox" is too literal.
- Lines may start with a tag such as "needs:", "wants:", "likes:", "craves:", "dreams of:",
  "is into:", "enjoys:" or "hobbies:". Use it only for tone (needs → practical and useful,
  dreams of → something special) and never copy the tag into the hint.
- Keep a colour or a clothing size (S, M, L…) only if it doesn't give the item away. Drop shoe
  sizes, model numbers and exact quantities.
- Warm and light, 5–12 words, ONE line, no numbering, no emoji, no quotes.
- Max 8 hints. Merge wishes that point to the same area. Skip empty lines.
- Do not invent wishes that are not implied by the input.

Examples (wish → good hint; the "too literal" version is what NOT to write):
- "Kindle Paperwhite" → "Something for long evenings lost in a good story"
  (too literal: "an e-reader")
- "wants: Le Creuset Dutch oven in blue" → "Something for slow Sunday cooking — blue is the favourite"
  (too literal: "a blue cast-iron pot")
- "craves: AirPods Pro" → "Something to make the daily commute sound better"
  (too literal: "wireless earbuds")
- "needs: Lego Technic Porsche" → "A rainy-weekend project with a lot of small pieces"
  (too literal: "a building-brick car set")
- "enjoys: Lindt dark chocolate" → "A little bittersweet treat for the afternoon coffee"
  (too literal: "dark chocolate")

- In "brands", list EVERY brand, product line, model name/number, shop, title and author name that
  appears in the input, exactly as written (e.g. "Sony", "WH-1000XM5", "lego", "Harry Potter").
  Empty list if none.
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
  "tv pc diy usb led hd xs s m l xl xxl xxxl eu us uk ok cd dvd vr ai " +
  "mum mom mummy mommy dad daddy mother father grandma grandpa granny grandad nan nana " +
  "sister brother aunt uncle santa"
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

/** Hints are max 160 characters (same as lib/validate.js) — cut at a word, never mid-word. */
function fitHint(h) {
  if (h.length <= 160) return h;
  const cut = h.slice(0, 159);
  return cut.slice(0, cut.lastIndexOf(" ") > 100 ? cut.lastIndexOf(" ") : 159).replace(/[\s,;:—-]+$/, "") + "…";
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
  return { clean: clean.slice(0, 8).map(fitHint), leaks };
}

/**
 * Try a single Gemini model. Returns the parsed JSON on success,
 * or throws an error. Errors with status 404 or 429 are marked
 * as retryable so the caller can try the next model.
 */
// Gemini 2.5+/3 models "think" before answering, which is most of the wait.
// Rewriting a few wishes needs little reasoning, so ask for the lowest level.
function thinkingConfigFor(model) {
  if (/^gemini-3/.test(model)) return { thinkingLevel: "low" };
  if (/^gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  return null;
}

async function tryModel(model, key, hintsText, useThinkingConfig = true) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const generationConfig = { temperature: 0.8, responseMimeType: "application/json" };
  const thinking = useThinkingConfig ? thinkingConfigFor(model) : null;
  if (thinking) generationConfig.thinkingConfig = thinking;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: hintsText }] }],
      generationConfig
    })
  });

  // a model that doesn't accept this thinking setting → same model, without it
  if (res.status === 400 && thinking) {
    const body = await res.text();
    if (/thinking/i.test(body)) {
      console.warn(`[gemini] ${model} rejected thinkingConfig, retrying without it`);
      return tryModel(model, key, hintsText, false);
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
      const started = Date.now();
      const parsed = await tryModel(model, key, hintsText);
      console.log(`[gemini] ${model} succeeded in ${Date.now() - started} ms`);
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
