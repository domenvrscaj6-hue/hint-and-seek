// lib/analytics.js
// Privacy-friendly analytics stored in Supabase (table analytics_events).
// Rules: no cookies, no IPs, no emails, no names, no wishes or hints — only an
// event name plus a few counts/labels. Tracking must NEVER break a real flow:
// every error is swallowed and the call gives up after 1.5 s.

export async function track(event, props = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    await fetch(`${url}/rest/v1/analytics_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ event: String(event).slice(0, 40), props }),
      signal: ctrl.signal
    });
  } catch (err) {
    console.error("[analytics] skipped:", err.message);
  } finally {
    clearTimeout(timer);
  }
}

/** Keeps only small non-negative integers — used for client-reported edit stats. */
export function cleanCounts(obj, fields) {
  const out = {};
  for (const f of fields) {
    const n = Number(obj?.[f]);
    out[f] = Number.isInteger(n) && n >= 0 && n <= 100 ? n : 0;
  }
  return out;
}
