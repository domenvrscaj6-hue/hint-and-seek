// lib/ideas.js
// Gift ideas for the people who received a wish list (UI: the tabs on the save page, api/hints.js).
//  - sharedPicks(): made ONCE per list, the same for every giver — a one-line profile, focus topics
//    and 3 picks at three price levels (no budget needed).
//  - wishIdeas():   made ONCE per wish, the same for every giver — 3 ideas for that one wish.
//  - personalPicks(): per giver — their focus topics, relationship, budget and what they know.
// Gemini receives the list text, the occasion and what the giver typed — never names or email
// addresses. So the texts never use the person's name or a gendered pronoun.

import { askGemini } from "./gemini.js";

const RULES = `Rules for every text you write:
- Never use the person's name, "you/your" for the person, or a gendered pronoun for the person or the giver —
  write implicitly ("for meals on the go", "after a long run"). Never guess anyone's gender: in languages that
  gender nouns and verbs (Slovenian, German, …) avoid gendered words and past-tense or adjective forms that
  show gender — use noun phrases instead ("študent" ✗, "rada" ✗).
- Real products / types only. Name a specific book, game or product only if you are sure it exists and is
  widely sold; otherwise describe the type. Never invent a title or a model. Write names exactly as sold
  ("Catan", "Codenames") — never translated, no translation or edition in brackets. Books: the ORIGINAL title
  and the author, e.g. "Atomic Habits (James Clear)" — never a translated title, even when the rest is in
  another language (the giver finds the local edition).
- No gender words in "gift" or "search" (men's / women's, "moška" / "ženska") — the list doesn't say.
- "search": a short shop search query with only what the gift is — no invented colours, sizes or editions.
- Language: the language most of the list is written in. Keep it short — "why" max 16 words.`;

const PICK_SHAPE = `{"kind":"safe|thoughtful|surprise","gift":"...","price":"~25 €","why":"...","search":"..."}`;

// Keep only normal text (any Latin script incl. č š ž, digits, punctuation). Models occasionally
// emit a stray character from another script — drop it.
function clean(s, max) {
  return String(s || "")
    .replace(/[^\p{Script=Latin}\p{N}\s.,;:!?'"’“”„()\-–—/&+%€$£#*]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
// The list never says anyone's gender, so a "men's …" gift or search would be a guess — drop such words.
const GENDER = /(?<!\p{L})(?:for (?:men|women)|(?:wo)?men'?s|mošk(?:i|a|o|e|ega|ih|im)|žensk(?:i|a|o|e|ega|ih|im)|herren|damen)(?!\p{L})/giu;
function ungender(s) {
  return s.replace(GENDER, "").replace(/\s+/g, " ").trim();
}
function cleanPicks(list, kinds) {
  return (Array.isArray(list) ? list : []).map((p, i) => {
    const gift = ungender(clean(p?.gift || p?.idea, 100));
    return {
      kind: kinds.includes(p?.kind) ? p.kind : kinds[i] || "",
      gift: gift.charAt(0).toUpperCase() + gift.slice(1),
      price: clean(p?.price, 20),
      why: clean(p?.why, 160),
      search: ungender(clean(p?.search || p?.gift || p?.idea, 80))
    };
  }).filter(p => p.gift).slice(0, 3);
}
function listText(groups) {
  return groups.map(g => `${g.label || "Wishes"}: ${g.hints.join("; ")}`).join("\n");
}
const KINDS = ["safe", "thoughtful", "surprise"];

/** Once per list: { profile, topics: [{name, items}], picks: [3] } */
export async function sharedPicks({ groups, occasion }) {
  const json = await askGemini(`You prepare gift suggestions that EVERY giver of this wish list will see (made once).
Return:
- "profile": what the list shows the person cares about, as ONE short noun phrase without verbs or gendered
  words, e.g. "Sport (gym, running, basketball), board games and sour sweets".
- "topics": 5–7 focus areas a giver could choose from, each 1–2 words and ONE area only (never "X and Y"), e.g.
  "Sport", "Board games", "Books", "Sweets", "Clothes", "Personal care", "Home" — each with the list items it covers.
  Every list item belongs to a topic.
- "picks": exactly 3, at three price levels — one under 20 €, one 30–50 €, one 60–100 €:
  "safe" = fulfils a Need/Want on the list; "thoughtful" = ONE gift that connects two different list items
  (e.g. a running belt that holds keys and a phone, for someone who runs);
  "surprise" (60–100 €) = a DIFFERENT kind of thing than every list item — if the list has board games, no
  board game; if it has socks, no clothes — yet it clearly fits the person: something they'd love but
  didn't think to ask for.
${RULES}
Output ONLY JSON: {"profile":"...","topics":[{"name":"...","items":["..."]}],"picks":[${PICK_SHAPE}]}`,
    `Wish list:\n${listText(groups)}\nOccasion: ${occasion}`, { temperature: 0.5 });
  return {
    profile: clean(json?.profile, 200),
    topics: (Array.isArray(json?.topics) ? json.topics : [])
      .map(t => ({ name: clean(t?.name, 30), items: (Array.isArray(t?.items) ? t.items : []).map(x => clean(x, 120)).slice(0, 12) }))
      .filter(t => t.name).slice(0, 7),
    picks: cleanPicks(json?.picks, KINDS)
  };
}

/** Once per wish: 3 ideas for one wish, spread over prices (no budget). */
export async function wishIdeas({ wish, groups, occasion }) {
  const json = await askGemini(`You suggest gifts for ONE wish from a person's wish list (the rest of the list is context).
Return exactly 3 concrete ideas that fulfil this wish, from cheaper to pricier. If the wish is already exact (a brand
and model), the first idea is that exact item.
${RULES}
Output ONLY JSON: {"picks":[{"gift":"...","price":"~25 €","why":"...","search":"..."}]}`,
    `The wish: "${wish}"\nWhole list:\n${listText(groups)}\nOccasion: ${occasion}`, { temperature: 0.4 });
  return cleanPicks(json?.picks, []);
}

/** Per giver: 3 picks inside the giver's focus topics, relationship and budget. */
export async function personalPicks({ groups, occasion, topics, relation, budget, note }) {
  const focus = topics.length
    ? topics.map(t => `${t.name}${t.items?.length ? ` (${t.items.join("; ")})` : ""}`).join("\n")
    : "(no preference — use the whole list)";
  const json = await askGemini(`You help ONE giver choose a gift from a person's wish list. Stay inside the focus topics the giver chose —
the giver knows those areas and wants nothing outside them.
Return exactly 3 picks within the budget: "safe" (fulfils a list item in the focus), "thoughtful" (combines two list
items, or a list item with what the giver wrote), "surprise" (NOT on the list, inside the focus topics, fits what the
giver knows). "why" says why it fits — use what the giver wrote.
${RULES}
Output ONLY JSON: {"picks":[${PICK_SHAPE}]}`,
    `Wish list:\n${listText(groups)}\nOccasion: ${occasion}\nFocus topics:\n${focus}\nThe giver is the person's: ${relation || "(not said)"}\nBudget: up to ${budget} €\nWhat the giver knows / wants: ${note || "(nothing)"}`,
    { temperature: 0.5 });
  return cleanPicks(json?.picks, KINDS);
}
