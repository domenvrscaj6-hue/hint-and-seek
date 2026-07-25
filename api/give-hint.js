// api/give-hint.js  (Vercel serverless function)
// Step 2 of the give flow (after the on-page preview).
// FAIL-SAFE pipeline — if ANY step fails, NOTHING is sent to recipients:
//   1. strict validation (all fields required, only specialNotes may be empty)
//   2. scrub edited hints again (no brand/model may leak back in)
//   3. blocklist check (Supabase required — no storage, no sending)
//   4. store the submission as PENDING with a one-time token
//   5. email a confirmation link to the sender — recipients get nothing yet.
// Recipients receive the hints only in api/confirm.js, after the sender clicks.

import { scrubAgainstRaw } from "../lib/gemini.js";
import { buildConfirmEmail, sendEmail } from "../lib/emails.js";
import { insertRow, updateRows, blockedAmong } from "../lib/store.js";
import { newToken } from "../lib/security.js";
import { validateGiveBody, validateHints } from "../lib/validate.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = req.body || {};
  if (b.website) return res.status(200).json({ ok: true }); // honeypot

  // ---------- step 1: strict validation ----------
  const v = validateGiveBody(b);
  if (v.error) return res.status(400).json({ error: v.error });

  const h = validateHints(b.hints);
  if (h.error) return res.status(400).json({ error: h.error });

  // ---------- step 2: re-scrub edited hints (fail-safe against leaks) ----------
  const hints = scrubAgainstRaw(v.sections, h.hints);
  for (const key of ["needs", "wants", "likes"]) {
    if (!hints[key].length) {
      return res.status(422).json({
        error: `One of your edited ${key} hints reveals the exact wish (a brand or model slipped in) — please reword it.`
      });
    }
  }

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
      raw_sections: v.sections,      // jsonb — the private wishes
      masked_hints: hints,           // jsonb — what recipients will see
      special_notes: v.specialNotes || null,
      token,
      status: "pending",
      expires_at: expiresAt
    });

    // ---------- step 5: confirmation email to the sender ----------
    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
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

    return res.status(200).json({ ok: true, pendingFor: recipients.length });
  } catch (err) {
    console.error("[give-hint]", err);
    return res.status(500).json({ error: "Something went wrong on our side — nothing was sent. Please try again." });
  }
}
