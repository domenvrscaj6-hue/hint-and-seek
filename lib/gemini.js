// lib/gemini.js
// Turns the raw wishes into gentle hints — nudges toward an area, never the exact item
// using the Google Gemini API. Requires env var GEMINI_API_KEY.
// Supports automatic model fallback: if the primary model is rate-limited
// or unavailable, the next model in the list is tried automatically.

export const MAX_HINTS = 30;   // same as lib/validate.js
export const MAX_GROUPS = 12;

// The prompt was compared on a 30-wish test set (Oct 2026) — see scripts/eval-hints.mjs.
const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash"
];

// Per wish the model first writes down the words that would give the item away ("avoid") and the
// part of life it belongs to ("area"), then writes the hint from the area only. Item-specific
// examples are deliberately left out: the model copied them word for word.
const SYSTEM_PROMPT = `You turn a person's gift wishes into gift HINTS for the people who will buy them a gift.
You get numbered lines (any language). A line may start with a tag ("needs:", "wants:", "likes:", "craves:",
"dreams of:", "is into:", "enjoys:", "hobbies:") and may list SEVERAL wishes separated by commas or "and".

Make one group per line, in the same order:
- "label": the tag itself, in English, capitalised — "Needs", "Wants", "Likes", "Craves", "Dreams of",
  "Is into", "Enjoys", "Hobbies" — whatever language the line is in. No tag → "".
- "items": one entry PER WISH on that line — never merge different wishes, never drop one. (Only a plain
  list of hobbies or interests, like "fitness, running, basketball", may stay as one item.)

For each wish fill in:
- "wish": the wish exactly as written (without the tag).
- "lang": the language of the line ("en", "sl", …).
- "kind": "specific" if it names a brand, model, title, author or exact product ("Nike Pegasus", "Kindle",
  "Alamut by Bartol", "JBL speaker"); "general" if it is only a type, a direction or an interest ("glavnik",
  "an interesting book about history", "warm socks", "fitness"). ANY brand, model, title or name makes it
  "specific" — also when the type is named too ("Nike long socks", "Haribo candy"): then hide the type as well.
- "avoid": words that would give a specific item away — the item, its category, close synonyms, brands,
  models, titles, author or place names (English plus the original words). For a general wish: only brands, if any.
- "area": the interest or part of life it belongs to, plainly ("running", "reading", "music at home").
- "hint":
  · GENERAL → the wish as written: same meaning, same level of detail, never vaguer, never more specific.
    Fix spelling and grammar, write it as a natural short phrase, and KEEP useful details from brackets or
    notes ("for running", "one big meal", "the current one is falling apart" → "Nahrbtnik, saj trenutni že
    razpada"). 2–12 words.
  · SPECIFIC → a nudge for the giver, built from the area and what the item is FOR — never from the item.
    Warm and plain, like a friend quietly tipping someone off, tied to a moment or routine ("those early runs",
    "Sunday mornings"). 5–12 words. The item should be one of the giver's first few guesses, not the only one.
    Keep a colour or clothing size (S/M/L) if given; drop shoe sizes, model numbers and quantities.

Language: write each hint in its own "lang" — correct, standard spelling and grammar; never invent words.
Never: a word from "avoid" in a specific hint; marketing words (elevate, enhance, essential, gear, experience,
premium, upgrade, ultimate, perfect); commands to the reader ("Enjoy…", "Keep…"); emoji; the tag itself.
Do not invent wishes. At most 30 items in total (if there are more, keep the 30 that matter most).

Also list every brand, product line, model name/number, shop, title and author from the input in "brands".
Output ONLY JSON:
{"groups":[{"label":"...","items":[{"wish":"...","lang":"sl","kind":"general","avoid":[],"area":"...","hint":"..."}]}],"brands":["..."]}`;

const REWRITE_PROMPT = `You rewrite gift hints that gave the item away. For each entry you get the "area" it belongs to,
the words to "avoid" and the old hint. Write a new warm, plain hint (5–12 words, same language as the old hint, no emoji) that points
to the same area and moment without using ANY word from "avoid". No marketing words, no commands.
Output ONLY JSON: {"hints":["..."]} — one per entry, same order.`;

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
  return { clean: clean.slice(0, MAX_HINTS).map(fitHint), leaks };
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

async function tryModel(model, key, systemPrompt, userText, useThinkingConfig = true) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const generationConfig = { temperature: 0.6, responseMimeType: "application/json" }; // lower = fewer grammar slips
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
      return tryModel(model, key, systemPrompt, userText, false);
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
const TAG_LABELS = {
  needs: "Needs", wants: "Wants", likes: "Likes", craves: "Craves", "dreams of": "Dreams of",
  "is into": "Is into", enjoys: "Enjoys", hobbies: "Hobbies",
  potrebno: "Needs", "would love": "Wants", "zaželeno": "Wants", priljubljeno: "Likes", cravings: "Craves",
  "skušnjave": "Craves", dreams: "Dreams of", sanje: "Dreams of", into: "Is into", zanimanja: "Is into",
  "v veselje": "Enjoys", "prosti čas": "Hobbies"
};
function groupLabel(label) {
  const raw = String(label || "").trim().replace(/:$/, "");
  return TAG_LABELS[raw.toLowerCase()] || raw.slice(0, 40);
}

/**
 * "General" only counts when the wish itself has no brand / model / title in it — "Nike long socks"
 * is specific even though it also names the type. Unknown line (merged wishes) → not general.
 */
function isGeneral(it, brandWords) {
  const wish = String(it?.wish || "");
  if (it?.kind !== "general" || !wish) return false;
  const lower = wish.toLowerCase();
  return !brandWords.some(b => lower.includes(b)) && brandLikeTokens(wish).size === 0;
}

/**
 * The model called a branded wish "general" and only dropped the brand ("A comfortable pair of long
 * socks"). Ask again for just those wishes, marked as specific, in one extra request.
 */
async function redoMisread(model, key, items) {
  const bad = items.filter(it => it.misread);
  if (!bad.length) return;
  console.log(`[gemini] re-doing ${bad.length} branded wish(es) the model called general`);
  try {
    const r = await tryModel(model, key, SYSTEM_PROMPT,
      bad.map((it, i) => `${i + 1}. ${it.wish}   (one wish; it names a brand → "specific")`).join("\n"));
    (Array.isArray(r.groups) ? r.groups : []).forEach((g, i) => {
      const x = Array.isArray(g?.items) ? g.items[0] : null;
      if (!bad[i] || !x?.hint) return;
      bad[i].hint = String(x.hint).trim();
      bad[i].avoid = (Array.isArray(x.avoid) ? x.avoid : []).map(a => String(a).trim().toLowerCase()).filter(a => a.length >= 2).slice(0, 20);
    });
  } catch (err) {
    console.warn(`[gemini] redo skipped: ${err.message}`);
  }
}

/**
 * Safety net: a hint that still contains one of its own "avoid" words (e.g. "shoes") is
 * rewritten once, in a single extra request. If that fails, the original hint stays —
 * the sender can still edit it in the preview.
 */
async function rewriteLiteral(model, key, items) {
  const bad = items.filter(it => findLeak(it.hint, new Set(it.avoid)));
  if (!bad.length) return;
  console.log(`[gemini] rewriting ${bad.length} literal hint(s)`);
  try {
    const r = await tryModel(model, key, REWRITE_PROMPT,
      JSON.stringify(bad.map(it => ({ area: it.area, avoid: it.avoid, old: it.hint }))));
    (Array.isArray(r.hints) ? r.hints : []).forEach((h, i) => {
      const it = bad[i];
      if (it && h && !findLeak(String(h), new Set(it.avoid))) it.hint = String(h).trim();
    });
  } catch (err) {
    console.warn(`[gemini] rewrite skipped: ${err.message}`);
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
      const lines = String(hintsText).split("\n").map(l => l.trim()).filter(Boolean);
      const parsed = await tryModel(model, key, SYSTEM_PROMPT, lines.map((l, i) => `${i + 1}. ${l}`).join("\n"));
      const brands = (Array.isArray(parsed.brands) ? parsed.brands : []).map(String).slice(0, 50);
      const brandWords = brands.map(b => b.toLowerCase()).filter(b => b.length >= 2);
      const groups = (Array.isArray(parsed.groups) ? parsed.groups : []).map(g => ({
        label: groupLabel(g?.label),
        items: (Array.isArray(g?.items) ? g.items : []).map(it => ({
          hint: String(it?.hint || "").trim(),
          wish: String(it?.wish || "").slice(0, 200),
          area: String(it?.area || "").slice(0, 80),
          // a general wish ("glavnik", "a history book") may keep its type word, so only brands count there
          avoid: (isGeneral(it, brandWords) ? [] : Array.isArray(it?.avoid) ? it.avoid : [])
            .map(a => String(a).trim().toLowerCase()).filter(a => a.length >= 2).slice(0, 20),
          misread: it?.kind === "general" && !isGeneral(it, brandWords)
        })).filter(it => it.hint)
      }));
      const items = groups.flatMap(g => g.items);
      await redoMisread(model, key, items);
      await rewriteLiteral(model, key, items);
      console.log(`[gemini] ${model} succeeded in ${Date.now() - started} ms`);

      // brand-leak check per group; lines with the same tag (or none) share one group
      const out = [];
      let left = MAX_HINTS;
      for (const g of groups) {
        const { clean } = checkHints(hintsText, g.items.map(it => it.hint), brands);
        const kept = clean.slice(0, left);
        left -= kept.length;
        if (!kept.length) continue;
        const same = out.find(o => o.label === g.label); // e.g. two "needs:" lines → one "Needs" group
        if (same) same.hints.push(...kept);
        else out.push({ label: g.label, hints: kept });
      }
      const finalGroups = out.slice(0, MAX_GROUPS);
      const specific = items.filter(it => it.avoid.length).length;
      return {
        hints: finalGroups.flatMap(g => g.hints), groups: finalGroups, brands,
        stats: { specific, general: items.length - specific } // counts only, for analytics
      };
    } catch (err) {
      console.warn(`[gemini] ${model} failed: ${err.message}`);
      lastErr = err;
      if (!err.retryable) throw err;
    }
  }

  throw lastErr;
}
