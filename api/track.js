// api/track.js  (Vercel serverless function)
// Receives anonymous page-view events from the frontend.
// Only whitelisted view names are accepted; nothing personal is stored.

import { track } from "../lib/analytics.js";
import { rateLimit } from "../lib/ratelimit.js";

const VIEWS = ["landing", "give", "preview", "get", "success"];
const SOURCES = ["direct", "invite"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await rateLimit(req, res, "track"))) return; // per-IP limit

  let b = req.body || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }

  const view = VIEWS.includes(b.view) ? b.view : null;
  if (!view) return res.status(400).json({ error: "Unknown view." });
  const source = SOURCES.includes(b.source) ? b.source : "direct";

  await track("page_view", { view, source });
  return res.status(204).end();
}
