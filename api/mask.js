// api/mask.js  (Vercel serverless function)
// Step 1 of the give flow: validate everything, mask wishes with Gemini,
// return the hints for the on-page preview. Nothing is stored or sent here.

import { maskWishes } from "../lib/gemini.js";
import { validateGiveBody } from "../lib/validate.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = req.body || {};
  if (b.website) return res.status(200).json({ ok: true, hints: { needs: [], wants: [], likes: [] } }); // honeypot

  const v = validateGiveBody(b);
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const hints = await maskWishes(v.sections);

    // Fail-safe: masking must produce at least one hint in EVERY section,
    // otherwise the flow stops here and nothing can be sent.
    for (const key of ["needs", "wants", "likes"]) {
      if (!hints[key].length) {
        return res.status(422).json({
          error: `We couldn't turn your ${key} into safe hints — try rephrasing them (one wish per line works best).`
        });
      }
    }

    return res.status(200).json({ ok: true, hints });
  } catch (err) {
    console.error("[mask]", err);
    return res.status(500).json({ error: "We couldn't prepare the hints right now — please try again." });
  }
}
