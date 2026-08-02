// lib/validate.js
// Strict fail-safe validation for the give flow.
// Two-tab system: "Hints & Surprises" (AI-masked) and "Exact Wishes" (pass-through).
// At least one item total across both tabs is required. Special notes stays optional.

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
    hints: String(b.sections?.hints || "").trim().slice(0, 3000),
    exact: String(b.sections?.exact || "").trim().slice(0, 3000)
  };

  if (senderName.length < 2) return { error: "Please provide your name." };
  if (!EMAIL_RE.test(senderEmail)) return { error: "Please provide your email — we send you a confirmation link first." };
  if (recipients.length === 0) return { error: "Add at least one valid recipient email." };
  if (!occasion) return { error: "Please choose an occasion." };
  if (!sections.hints && !sections.exact) {
    return { error: "Write at least one wish — either a hint for the AI to rephrase, or an exact wish. Both tabs can't be empty." };
  }

  return { senderName, senderEmail, occasion, specialNotes, recipients, sections };
}

/** Hints object: at least one item total across both sections. */
export function validateHints(h) {
  const clean = {};
  clean.hints = (Array.isArray(h?.hints) ? h.hints : [])
    .map(x => String(x).trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 6);
  clean.exact = (Array.isArray(h?.exact) ? h.exact : [])
    .map(x => String(x).trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 10);

  if (clean.hints.length === 0 && clean.exact.length === 0) {
    return { error: "There are no hints or wishes left — you need at least one." };
  }
  return { hints: clean };
}
