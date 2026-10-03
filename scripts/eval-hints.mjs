// scripts/eval-hints.mjs — check the wish → hint quality of lib/gemini.js on a fixed test set.
//
//   GEMINI_API_KEY=... node scripts/eval-hints.mjs            (optionally GEMINI_MODEL=...)
//
// Sends the wishes in groups of 5 (like a real submission) through the production maskWishes()
// and prints every hint, flagging the ones that contain a word that gives the item away.
// Read the hints yourself too: a good hint names the AREA ("running", "movie nights"), never
// the item, and the item should be one of the giver's first guesses.
// Free-tier keys allow only ~20 requests per model per day — one run uses about 6–8.

import { maskWishes } from "../lib/gemini.js";
import { CASES } from "./hint-cases.mjs";

if (!process.env.GEMINI_API_KEY) {
  console.error("Set GEMINI_API_KEY first.");
  process.exit(1);
}

let literal = 0, total = 0;
for (let i = 0; i < CASES.length; i += 5) {
  const group = CASES.slice(i, i + 5);
  const started = Date.now();
  const { hints } = await maskWishes(group.map(c => c[0]).join("\n"));
  console.log(`\n— ${group.length} wishes, ${Date.now() - started} ms`);
  group.forEach(([wish, avoid], j) => {
    const hint = hints[j] || "(no hint)";
    const hit = avoid.filter(a => hint.toLowerCase().includes(a));
    total++; if (hit.length) literal++;
    console.log(`${wish.padEnd(42).slice(0, 42)} → ${hint}${hit.length ? `   ⚠ ${hit.join(", ")}` : ""}`);
  });
  await new Promise(r => setTimeout(r, 13000)); // free tier: ~5 requests / minute
}
console.log(`\nLiteral hints: ${literal}/${total}`);
