// lib/ideas.js
// "Gift ideas" for a giver: one wish from the list → 3 concrete ideas within a budget.
// Only called when a giver asks for it on the save page (api/ideas.js). Gemini receives the wish,
// the rest of the list, the occasion, the budget and the giver's optional note — never names or emails.

import { askGemini } from "./gemini.js";

const SYSTEM_PROMPT = `You help someone choose a gift. You get ONE wish from a person's wish list, the rest of
their list (for context about the person), the occasion, the giver's budget in EUR and an optional note
from the giver.

Suggest exactly 3 concrete, easy-to-find gift ideas that fit the wish, the person and the budget:
- real product types or well-known products / titles / games that exist. Only name a specific book, game
  or product if you are sure it exists and is widely sold; if unsure, describe the type instead
  ("a popular sci-fi novel from the last few years") — never invent a title or a model;
- each idea costs about the budget or less (a typical price is enough — prices vary by shop);
- if the wish is already exact (a brand and model), the first idea is that exact item, the others are
  close alternatives or a nice small extra that goes with it;
- respect the giver's note (e.g. "he already has Catan", "for two players").

Language: write "idea" and "why" in the language most of the list is written in (the people buying the
gift read it) — a mostly Slovenian list → Slovenian.
Titles and names: give book, game, film and product names in their ORIGINAL title exactly as published
(e.g. "Atomic Habits", "The Hitchhiker's Guide to the Galaxy") — never translate or adapt a title.
"why": one short, warm sentence (max 18 words).
Output ONLY JSON: {"ideas":[{"idea":"...","price":"~25 €","why":"..."}]}`;

// Keep only normal text: letters (any Latin script incl. č š ž), digits, spaces and common punctuation.
// Models occasionally emit a stray character from another script ("sหมučno") — drop those.
function clean(s, max) {
  return String(s || "")
    .replace(/[^\p{Script=Latin}\p{N}\s.,;:!?'"’“”„()\-–—/&+%€$£#*]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * @returns {Promise<Array<{idea:string, price:string, why:string}>>} up to 3 ideas
 */
export async function giftIdeas({ wish, others, occasion, budget, note }) {
  const user = [
    `Wish: "${wish}"`,
    `Rest of the list: ${others.length ? others.join("; ") : "(nothing else)"}`,
    `Occasion: ${occasion}`,
    `Budget: up to ${budget} €`,
    `Giver's note: ${note || "(none)"}`
  ].join("\n");
  const json = await askGemini(SYSTEM_PROMPT, user, { temperature: 0.4 });
  return (Array.isArray(json?.ideas) ? json.ideas : [])
    .map(i => ({ idea: clean(i?.idea, 100), price: clean(i?.price, 20), why: clean(i?.why, 160) }))
    .filter(i => i.idea)
    .slice(0, 3);
}
