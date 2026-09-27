// api/get-hint.js  (Vercel serverless function)
// Pull flow: someone asks a person for gift hints. We send that person a
// friendly invite email that links back to the "Give a hint" form.
// Fail-safe: validation → blocklist check → store → send; any failure = nothing sent.

import { buildInviteEmail, sendEmail } from "../lib/emails.js";
import { insertRow, blockedAmong } from "../lib/store.js";
import { unsubscribeUrl } from "../lib/security.js";
import { OCCASIONS, EMAIL_RE } from "../lib/validate.js";
import { rateLimit } from "../lib/ratelimit.js";
import { track } from "../lib/analytics.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = req.body || {};
  if (b.website) return res.status(200).json({ ok: true }); // honeypot
  if (!(await rateLimit(req, res, "get"))) return; // per-IP limit

  const requesterName = String(b.requesterName || "").trim().slice(0, 80);
  const requesterEmail = String(b.requesterEmail || "").trim().toLowerCase();
  const targetEmail = String(b.targetEmail || "").trim().toLowerCase();
  const occasion = OCCASIONS.includes(b.occasion) ? b.occasion : null;

  if (requesterName.length < 2) return res.status(400).json({ error: "Please provide your name." });
  if (!EMAIL_RE.test(requesterEmail)) return res.status(400).json({ error: "Please provide your email." });
  if (!EMAIL_RE.test(targetEmail)) return res.status(400).json({ error: "That email address doesn't look right." });
  if (!occasion) return res.status(400).json({ error: "Please choose an occasion." });

  try {
    // Fail-safe: respect opt-outs before anything else.
    const blocked = await blockedAmong([targetEmail]);
    if (blocked.has(targetEmail)) {
      return res.status(422).json({ error: "This person has opted out of Hint & Seek emails, so we can't reach them." });
    }

    await insertRow("hint_requests", {
      requester_name: requesterName,
      requester_email: requesterEmail,
      target_email: targetEmail,
      occasion
    });

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const { subject, html } = buildInviteEmail({
      requesterName,
      requesterEmail,
      occasion,
      siteUrl,
      unsubscribeUrl: unsubscribeUrl(siteUrl, targetEmail)
    });
    await sendEmail({ to: targetEmail, subject, html });

    await track("get_submitted", { occasion });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[get-hint]", err);
    return res.status(500).json({ error: "Something went wrong on our side — nothing was sent. Please try again." });
  }
}
