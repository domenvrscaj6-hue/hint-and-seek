// lib/validate.js
// Strict fail-safe validation for the give flow.
// Wishes are always masked by the AI — there is no "exact" pass-through.
// Anything the person wants word-for-word goes into the optional special notes.

export const OCCASIONS = ["christmas", "birthday", "other"];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateGiveBody(b) {
  const senderName = String(b.senderName || "").trim().slice(0, 80);
  const senderEmail = String(b.senderEmail || "").trim().toLowerCase();
  const occasion = OCCASIONS.includes(b.occasion) ? b.occasion : null;
  const specialNotes = String(b.specialNotes || "").trim().slice(0, 600); // the ONLY optional field

  const recipients = Array.isArray(b.recipients)
    ? [...new Set(b.recipients.map(e => String(e).trim().toLowerCase()))]
        .filter(e => EMAIL_RE.test(e))
        .slice(0, 20)
    : [];

  const sections = {
    hints: String(b.sections?.hints || "").trim().slice(0, 3000)
  };

  if (senderName.length < 2) return { error: "Please provide your name." };
  if (!EMAIL_RE.test(senderEmail)) return { error: "Please provide your email — we send you a confirmation link first." };
  if (recipients.length === 0) return { error: "Add at least one valid recipient email." };
  if (!occasion) return { error: "Please choose an occasion." };
  if (!sections.hints) return { error: "Write at least one wish — the AI turns it into a gentle hint." };

  return { senderName, senderEmail, occasion, specialNotes, recipients, sections };
}

/** Hints object { hints: [...] }: at least one hint. `exact` is always empty (kept for the stored shape). */
export function validateHints(h) {
  const hints = (Array.isArray(h?.hints) ? h.hints : [])
    .map(x => String(x).trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 8);

  if (hints.length === 0) return { error: "There are no hints left — you need at least one." };
  return { hints: { hints, exact: [] } };
}
