// api/ideas.js  (Vercel serverless function)
// POST { id, sig, wish, budget, note } → { ideas: [{ idea, price, why }] }
// Gift ideas for ONE wish of a sent list, asked for by a giver on the save page (api/hints.js).
// Guards, so the paid AI is only used with intent:
//  - the signed link (same id + sig as the save page) — only people who got the list can ask;
//  - the wish must be on that list (no free-form prompts);
//  - per IP: LIMITS.ideas in lib/ratelimit.js;
//  - per list: MAX_PER_LIST answers from the AI; repeated questions (same wish + budget + note)
//    come from the stored cache for free.

import crypto from "crypto";
import { selectRows, updateRows } from "../lib/store.js";
import { verifyHintsSig } from "../lib/security.js";
import { rateLimit } from "../lib/ratelimit.js";
import { track } from "../lib/analytics.js";
import { giftIdeas } from "../lib/ideas.js";

const MAX_PER_LIST = 30;   // AI answers per sent list, across all its givers
const MAX_CACHE = 40;      // cached answers kept per list
const BUDGETS = [10, 20, 30, 50, 100, 200];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await rateLimit(req, res, "ideas"))) return;

  const b = req.body || {};
  const id = String(b.id || "");
  const wish = String(b.wish || "").trim().slice(0, 200);
  const budget = BUDGETS.includes(Number(b.budget)) ? Number(b.budget) : null;
  const note = String(b.note || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyHintsSig(id, String(b.sig || ""))) {
    return res.status(400).json({ error: "Please open the list from your email again." });
  }
  if (!wish || !budget) return res.status(400).json({ error: "Pick a wish and a budget." });

  try {
    // ideas_* columns come from schema.sql (Oct 2026); without them we still answer, just without cache/cap
    let rows, hasCache = true;
    try {
      rows = await selectRows("hint_submissions", { select: "status,occasion,masked_hints,ideas_count,ideas_cache", id: `eq.${id}` });
    } catch (e) {
      if (!/ideas_/.test(e.message)) throw e;
      hasCache = false;
      rows = await selectRows("hint_submissions", { select: "status,occasion,masked_hints", id: `eq.${id}` });
    }
    const sub = rows[0];
    if (!sub || sub.status !== "sent") return res.status(404).json({ error: "This list is no longer available." });

    const all = (sub.masked_hints?.hints || []).map(String);
    if (!all.includes(wish)) return res.status(400).json({ error: "That wish isn't on this list." });

    const key = crypto.createHash("sha256").update(`${wish}|${budget}|${note.toLowerCase()}`).digest("hex").slice(0, 16);
    const cache = hasCache && sub.ideas_cache && typeof sub.ideas_cache === "object" ? sub.ideas_cache : {};
    if (cache[key]) {
      await track("ideas_requested", { cached: true, budget });
      return res.status(200).json({ ideas: cache[key] });
    }
    if (hasCache && (sub.ideas_count || 0) >= MAX_PER_LIST) {
      return res.status(429).json({ error: "This list has had a lot of idea requests already — the ideas you got are still above." });
    }

    const ideas = await giftIdeas({ wish, others: all.filter(w => w !== wish).slice(0, 29), occasion: sub.occasion, budget, note });
    if (!ideas.length) return res.status(502).json({ error: "No ideas came back this time — please try again." });

    if (hasCache) {
      const keys = Object.keys(cache);
      const nextCache = { ...cache, [key]: ideas };
      keys.slice(0, Math.max(0, keys.length + 1 - MAX_CACHE)).forEach(k => delete nextCache[k]); // drop the oldest
      await updateRows("hint_submissions", { id: `eq.${id}` }, { ideas_cache: nextCache, ideas_count: (sub.ideas_count || 0) + 1 })
        .catch(e => console.error("[ideas] cache not saved:", e.message));
    }
    await track("ideas_requested", { cached: false, budget });
    return res.status(200).json({ ideas });
  } catch (err) {
    console.error("[ideas]", err);
    return res.status(500).json({ error: "We couldn't get ideas right now — please try again in a moment." });
  }
}
