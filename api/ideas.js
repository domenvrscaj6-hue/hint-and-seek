// api/ideas.js  (Vercel serverless function)
// POST { id, sig, mode, ... } — gift ideas for the givers of a sent list, asked for on the save page
// (the tabs in api/hints.js). Three modes:
//  - "shared":   { } → { profile, topics: ["Sport", …], picks: [3] }
//                made ONCE per list by the first visitor, then everyone sees the same snapshot;
//  - "wish":     { wish } → { picks: [3] }   made ONCE per wish, the same for everyone;
//  - "personal": { topics, relation, budget, note } → { picks: [3] }   per giver.
// Guards, so the paid AI is only used with intent:
//  - the signed link (same id + sig as the save page) — only people who got the list can ask;
//  - the wish must be on that list, focus topics must come from the shared snapshot (no free-form prompts
//    except the giver's short note);
//  - per IP: LIMITS.ideas in lib/ratelimit.js, counted only when the AI is actually called;
//  - per list: MAX_PER_LIST answers from the AI; everything already made comes from the stored cache for free.

import crypto from "crypto";
import { selectRows, updateRows } from "../lib/store.js";
import { verifyHintsSig } from "../lib/security.js";
import { rateLimit } from "../lib/ratelimit.js";
import { track } from "../lib/analytics.js";
import { sharedPicks, wishIdeas, personalPicks } from "../lib/ideas.js";

const MAX_PER_LIST = 30;   // AI answers per sent list, across all its givers (the shared snapshot doesn't count)
const MAX_CACHE = 40;      // cached answers kept per list
const BUDGETS = [20, 30, 50, 100, 200];
const RELATIONS = ["partner", "family", "friend", "colleague", "other"];

function hash(s) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

// keep "shared" forever; drop personal answers first, then per-wish ones, oldest first
function evict(cache) {
  const keys = Object.keys(cache);
  let extra = keys.length - MAX_CACHE;
  for (const prefix of ["p:", "w:"]) {
    for (const k of keys) {
      if (extra <= 0) return cache;
      if (k.startsWith(prefix)) { delete cache[k]; extra--; }
    }
  }
  return cache;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = req.body || {};
  const id = String(b.id || "");
  const mode = ["shared", "wish", "personal"].includes(b.mode) ? b.mode : "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyHintsSig(id, String(b.sig || ""))) {
    return res.status(400).json({ error: "Please open the list from your email again." });
  }
  if (!mode) return res.status(400).json({ error: "Unknown request." });

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
    const groups = (Array.isArray(sub.masked_hints?.groups) && sub.masked_hints.groups.length
      ? sub.masked_hints.groups
      : [{ label: "", hints: all }]
    ).map(g => ({ label: String(g.label || ""), hints: (g.hints || []).map(String) })).filter(g => g.hints.length);
    const cache = hasCache && sub.ideas_cache && typeof sub.ideas_cache === "object" ? sub.ideas_cache : {};
    const occasion = sub.occasion;

    // what to make, and under which cache key
    let key, make;
    if (mode === "shared") {
      key = "shared";
      make = () => sharedPicks({ groups, occasion });
    } else if (mode === "wish") {
      const wish = String(b.wish || "").trim().slice(0, 200);
      if (!all.includes(wish)) return res.status(400).json({ error: "That wish isn't on this list." });
      key = "w:" + hash(wish);
      make = () => wishIdeas({ wish, groups, occasion });
    } else {
      const budget = BUDGETS.includes(Number(b.budget)) ? Number(b.budget) : null;
      if (!budget) return res.status(400).json({ error: "Pick a budget." });
      const relation = RELATIONS.includes(b.relation) ? b.relation : "";
      const note = String(b.note || "").replace(/\s+/g, " ").trim().slice(0, 300);
      // focus topics: only the ones offered in the shared snapshot, with the list items they cover
      const offered = cache.shared?.topics || [];
      const asked = (Array.isArray(b.topics) ? b.topics : []).map(String);
      const topics = offered.filter(t => asked.includes(t.name));
      key = "p:" + hash([topics.map(t => t.name).sort().join(","), relation, budget, note.toLowerCase()].join("|"));
      make = () => personalPicks({ groups, occasion, topics, relation, budget, note });
    }

    const send = async (result, cached) => {
      await track("ideas_requested", { mode, cached });
      return res.status(200).json(mode === "shared"
        ? { profile: result.profile, topics: result.topics.map(t => t.name), picks: result.picks }
        : { picks: result });
    };

    if (cache[key]) return send(cache[key], true);
    if (hasCache && mode !== "shared" && (sub.ideas_count || 0) >= MAX_PER_LIST) {
      return res.status(429).json({ error: "This list has had a lot of idea requests already — try the other tabs, those ideas are ready." });
    }
    if (!(await rateLimit(req, res, "ideas"))) return;

    const result = await make();
    const picks = mode === "shared" ? result.picks : result;
    if (!picks.length) return res.status(502).json({ error: "No ideas came back this time — please try again." });

    if (hasCache) {
      // re-read the cache right before saving, so answers made meanwhile by other givers aren't lost
      const fresh = await selectRows("hint_submissions", { select: "ideas_count,ideas_cache", id: `eq.${id}` })
        .then(r => r[0] || {}, () => ({ ideas_count: sub.ideas_count, ideas_cache: cache }));
      const base = fresh.ideas_cache && typeof fresh.ideas_cache === "object" ? fresh.ideas_cache : {};
      const nextCache = evict({ ...base, [key]: result });
      await updateRows("hint_submissions", { id: `eq.${id}` }, { ideas_cache: nextCache, ideas_count: (fresh.ideas_count || 0) + (mode === "shared" ? 0 : 1) })
        .catch(e => console.error("[ideas] cache not saved:", e.message));
    }
    return send(result, false);
  } catch (err) {
    console.error("[ideas]", err);
    return res.status(500).json({ error: "We couldn't get ideas right now — please try again in a moment." });
  }
}
