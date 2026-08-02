// api/mask.js  (Vercel serverless function)
// Step 1 of the give flow: validate everything, mask the "Hints & Surprises"
// section with Gemini, and pass "Exact Wishes" through untouched.
// Nothing is stored or sent here.

import { maskWishes } from "../lib/gemini.js";
import { validateGiveBody } from "../lib/validate.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = req.body || {};
  if (b.website) return res.status(200).json({ ok: true, hints: { hints: [], exact: [] } }); // honeypot

  const v = validateGiveBody(b);
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const result = { hints: [], exact: [] };

    // "Hints & Surprises" → send to Gemini for masking
    if (v.sections.hints) {
      const masked = await maskWishes(v.sections.hints);
      if (!masked.length) {
        return res.status(422).json({
          error: "We couldn't turn your hints into safe rephrases — try rephrasing them (one wish per line works best)."
        });
      }
      result.hints = masked;
    }

    // "Exact Wishes" → pass through untouched (just split by newlines, trim, deduplicate)
    if (v.sections.exact) {
      result.exact = v.sections.exact
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .slice(0, 10);
    }

    return res.status(200).json({ ok: true, hints: result });
  } catch (err) {
    console.error("[mask]", err);
    return res.status(500).json({ error: "We couldn't prepare the hints right now — please try again." });
  }
}
