// api/mask.js  (Vercel serverless function)
// Step 1 of the give flow: validate everything and mask the wishes with Gemini.
// Nothing is stored or sent here.

import { maskWishes } from "../lib/gemini.js";
import { validateGiveBody } from "../lib/validate.js";
import { rateLimit } from "../lib/ratelimit.js";
import { track } from "../lib/analytics.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = req.body || {};
  if (b.website) return res.status(200).json({ ok: true, hints: { hints: [] }, brands: [] }); // honeypot
  if (!(await rateLimit(req, res, "mask"))) return; // per-IP limit

  const v = validateGiveBody(b);
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const masked = await maskWishes(v.sections.hints);
    if (!masked.hints.length) {
      await track("mask_failed", { occasion: v.occasion });
      return res.status(422).json({
        error: "We couldn't turn your wishes into safe hints — try rephrasing them (one wish per line works best)."
      });
    }
    await track("mask_ok", { occasion: v.occasion, hints: masked.hints.length });
    // brands go back to the browser so give-hint.js can re-check the user's edits against them
    return res.status(200).json({ ok: true, hints: { hints: masked.hints }, brands: masked.brands });
  } catch (err) {
    console.error("[mask]", err);
    return res.status(500).json({ error: "We couldn't prepare the hints right now — please try again." });
  }
}
