// lib/security.js
// Signed unsubscribe links + confirmation tokens.
// Requires env var APP_SECRET (any long random string).

import crypto from "crypto";

function secret() {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error("APP_SECRET is not set");
  return s;
}

export function signEmail(email) {
  return crypto.createHmac("sha256", secret())
    .update(String(email).toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export function verifyEmailSig(email, sig) {
  try {
    const expected = Buffer.from(signEmail(email));
    const given = Buffer.from(String(sig || ""));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}

export function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * Canonical site URL for links in emails, e.g. "https://www.hintandseek.com".
 * Trailing slashes are removed so links never become "…com//api/confirm".
 */
export function siteUrlFrom(req) {
  return String(process.env.SITE_URL || `https://${req.headers.host}`).trim().replace(/\/+$/, "");
}

export function unsubscribeUrl(siteUrl, email) {
  return `${siteUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&sig=${signEmail(email)}`;
}
