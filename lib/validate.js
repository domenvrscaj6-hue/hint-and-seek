// lib/validate.js
// Strict fail-safe validation for the give flow: every step must be complete
// (only specialNotes may be empty). Returns { error } or the cleaned payload.

export const OCCASIONS = ["christmas", "birthday", "other"];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SECTION_NAMES = { needs: "Needs", wants: "Wants", likes: "Likes" };

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
    needs: String(b.sections?.needs || "").trim().slice(0, 1500),
    wants: String(b.sections?.wants || "").trim().slice(0, 1500),
    likes: String(b.sections?.likes || "").trim().slice(0, 1500)
  };

  if (senderName.length < 2) return { error: "Please provide your name." };
  if (!EMAIL_RE.test(senderEmail)) return { error: "Please provide your email — we send you a confirmation link first." };
  if (recipients.length === 0) return { error: "Add at least one valid recipient email." };
  if (!occasion) return { error: "Please choose an occasion." };
  for (const key of ["needs", "wants", "likes"]) {
    if (!sections[key]) return { error: `The ${SECTION_NAMES[key]} section is empty — every section is required, only Special notes may stay empty.` };
  }

  return { senderName, senderEmail, occasion, specialNotes, recipients, sections };
}

/** Hints object: every section must keep at least one hint. */
export function validateHints(h) {
  const clean = {};
  for (const key of ["needs", "wants", "likes"]) {
    clean[key] = (Array.isArray(h?.[key]) ? h[key] : [])
      .map(x => String(x).trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 6);
    if (clean[key].length === 0) {
      return { error: `The ${SECTION_NAMES[key]} section has no hints — every section needs at least one.` };
    }
  }
  return { hints: clean };
}
