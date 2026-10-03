// lib/ratelimit.js
// Per-IP rate limiting backed by Supabase (no extra service, zero dependencies).
// The counting happens atomically inside the Postgres function hit_rate_limit()
// defined in schema.sql. IPs are never stored in plain text — only an HMAC hash.
//
// If the limiter itself fails (e.g. Supabase hiccup) we let the request through:
// the limiter only protects against abuse, it is not a sending gate. Every
// sending step still has its own fail-safe checks (storage, blocklist, confirmation).

import crypto from "crypto";

// Limits per IP. Tune here if real users hit them.
export const LIMITS = {
  give:     { max: 5,  windowSeconds: 60 * 60 },      // confirmation emails: 5 / hour
  get:      { max: 5,  windowSeconds: 60 * 60 },      // invite emails: 5 / hour
  feedback: { max: 5,  windowSeconds: 60 * 60 },      // feedback emails: 5 / hour
  ideas:    { max: 10, windowSeconds: 60 * 60 },     // gift ideas (paid AI): 10 / hour
  track:    { max: 200, windowSeconds: 60 * 60 }      // anonymous page views: 200 / hour
};

function clientIp(req) {
  const fwd = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.headers?.["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function hashIp(ip) {
  const secret = process.env.APP_SECRET || "hint-and-seek";
  return crypto.createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}

/**
 * Returns true if the request may continue. If the limit is exceeded, it
 * already sent a 429 response and returns false.
 * Usage:  if (!(await rateLimit(req, res, "mask"))) return;
 */
export async function rateLimit(req, res, bucket) {
  const limit = LIMITS[bucket];
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!limit || !url || !key) return true;

  try {
    const r = await fetch(`${url}/rest/v1/rpc/hit_rate_limit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        p_key: `${bucket}:${hashIp(clientIp(req))}`,
        p_window_seconds: limit.windowSeconds,
        p_max: limit.max
      })
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    const allowed = await r.json();
    if (allowed === false) {
      res.setHeader("Retry-After", String(limit.windowSeconds));
      res.status(429).json({
        error: "You've done this quite a few times in a short while — please take a little break and try again later."
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[ratelimit] limiter unavailable, letting request through:", err.message);
    return true;
  }
}
