// api/give-hint.js  (Vercel serverless function)
// Step 2 of the give flow (after the on-page preview).
// FAIL-SAFE pipeline — if ANY step fails, NOTHING is sent to recipients:
//   1. strict validation (at least one wish / hint)
//   2. re-check edited hints (no brand/model may leak back in)
//   3. blocklist check (Supabase required — no storage, no sending)
//   4. store the submission as PENDING with a one-time token
//   5. email a confirmation link to the sender — recipients get nothing yet.
// Recipients receive the hints only in api/confirm.js, after the sender clicks.

import { checkHints } from "../lib/gemini.js";
import { buildConfirmEmail, sendEmail } from "../lib/emails.js";
import { insertRow, updateRows, blockedAmong } from "../lib/store.js";
import { newToken, siteUrlFrom } from "../lib/security.js";
import { validateGiveBody, validateHints } from "../lib/validate.js";
import { rateLimit } from "../lib/ratelimit.js";
import { track, cleanCounts } from "../lib/analytics.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = req.body || {};
  if (b.website) return res.status(200).json({ ok: true }); // honeypot
  if (!(await rateLimit(req, res, "give"))) return; // per-IP limit

  // ---------- step 1: strict validation ----------
  const v = validateGiveBody(b);
  if (v.error) return res.status(400).json({ error: v.error });

  const h = validateHints(b.hints);
  if (h.error) return res.status(400).json({ error: h.error });

  // ---------- step 2: re-check edited hints (fail-safe against leaks) ----------
  // `brands` comes from /api/mask (Gemini's brand list); the heuristic check runs regardless.
  const { clean, leaks } = checkHints(v.sections.hints, h.hints.hints, b.brands);
  if (leaks.length) {
    const first = leaks[0];
    return res.status(422).json({
      error: `This hint still gives away “${first.word}”: “${first.hint}”. Please reword it (or remove it) — nothing was sent.`
    });
  }
  // keep the groups ("Needs", "Would love", …) the sender saw in the preview; nothing leaked, so they're clean
  const hints = h.hints.groups
    ? { hints: h.hints.hints, groups: h.hints.groups, exact: [] }
    : { hints: clean, exact: [] };

  try {
    // ---------- step 3: blocklist ----------
    const blocked = await blockedAmong(v.recipients);
    const recipients = v.recipients.filter(r => !blocked.has(r));
    if (recipients.length === 0) {
      return res.status(422).json({ error: "Everyone on your list has opted out of Hint & Seek emails, so nothing can be sent." });
    }

    // ---------- step 4: store as pending ----------
    const token = newToken();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await insertRow("hint_submissions", {
      sender_name: v.senderName,
      sender_email: v.senderEmail,
      occasion: v.occasion,
      recipients,                    // jsonb
      raw_sections: v.sections,      // jsonb — the private wishes { hints }
      masked_hints: hints,           // jsonb — what recipients will see { hints: [...], exact: [] }
      special_notes: v.specialNotes || null,
      token,
      status: "pending",
      expires_at: expiresAt
    });

    // ---------- step 5: confirmation email to the sender ----------
    const siteUrl = siteUrlFrom(req);
    const confirmUrl = `${siteUrl}/api/confirm?token=${token}`;
    try {
      const { subject, html } = buildConfirmEmail({
        senderName: v.senderName,
        occasion: v.occasion,
        recipients,
        hints,
        specialNotes: v.specialNotes,
        confirmUrl
      });
      await sendEmail({ to: v.senderEmail, subject, html });
    } catch (mailErr) {
      // fail-safe: mark the row so the token can never be used
      await updateRows("hint_submissions", { token: `eq.${token}` }, { status: "failed" }).catch(() => {});
      throw mailErr;
    }

    // Anonymous stats: how much the sender changed the AI hints (counts only).
    await track("give_submitted", {
      occasion: v.occasion,
      recipients: recipients.length,
      hints: hints.hints.length,
      ...cleanCounts(b.editStats, ["generated", "kept", "edited", "deleted", "added"])
    });
    return res.status(200).json({ ok: true, pendingFor: recipients.length });
  } catch (err) {
    console.error("[give-hint]", err);
    return res.status(500).json({ error: "Something went wrong on our side — nothing was sent. Please try again." });
  }
}
