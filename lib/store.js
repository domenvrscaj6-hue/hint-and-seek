// lib/store.js
// Supabase REST helpers. Storage is REQUIRED in this version: the double
// opt-in flow (pending → confirmed) and the blocklist both live here, so a
// missing configuration must FAIL the request — nothing may be sent without it.

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set — storage is required");
  return { url, key };
}

function headers(key, extra = {}) {
  return {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra
  };
}

async function fail(res, what) {
  const body = await res.text();
  throw new Error(`[store] ${what} failed: ${res.status} ${body.slice(0, 300)}`);
}

export async function insertRow(table, row) {
  const { url, key } = cfg();
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: headers(key, { Prefer: "return=minimal" }),
    body: JSON.stringify(row)
  });
  if (!res.ok) await fail(res, `insert into ${table}`);
}

export async function selectRows(table, params) {
  const { url, key } = cfg();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}/rest/v1/${table}?${qs}`, { headers: headers(key) });
  if (!res.ok) await fail(res, `select from ${table}`);
  return res.json();
}

export async function updateRows(table, params, patch) {
  const { url, key } = cfg();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}/rest/v1/${table}?${qs}`, {
    method: "PATCH",
    headers: headers(key, { Prefer: "return=minimal" }),
    body: JSON.stringify(patch)
  });
  if (!res.ok) await fail(res, `update ${table}`);
}

/** Returns a Set of the given emails that are on the blocklist. */
export async function blockedAmong(emails) {
  if (!emails.length) return new Set();
  const inList = `in.(${emails.map(e => `"${e}"`).join(",")})`;
  const rows = await selectRows("blocklist", { select: "email", email: inList });
  return new Set(rows.map(r => r.email));
}

/** Adds an email to the blocklist (idempotent). */
export async function addToBlocklist(email) {
  const { url, key } = cfg();
  const res = await fetch(`${url}/rest/v1/blocklist?on_conflict=email`, {
    method: "POST",
    headers: headers(key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ email: String(email).toLowerCase() })
  });
  if (!res.ok) await fail(res, "insert into blocklist");
}
