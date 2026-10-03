// lib/validate.js
// Strict fail-safe validation for the give flow.
// Wishes are always masked by the AI — there is no "exact" pass-through.
// Anything the person wants word-for-word goes into the optional special notes.

export const OCCASIONS = ["christmas", "birthday", "valentine", "other"];
// No quotes, brackets, commas etc.: real addresses don't need them, and they could break
// the blocklist query or the HTML of an email.
export const EMAIL_RE = /^[^\s@"'<>()\[\],;:\\]+@[^\s@"'<>()\[\],;:\\]+\.[^\s@"'<>()\[\],;:\\]{2,}$/;

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

export const MAX_HINTS = 30;   // same as lib/gemini.js
export const MAX_GROUPS = 12;

/**
 * Hints object { hints: [...], groups?: [{ label, hints: [...] }] } — at least one hint.
 * When groups are sent (one per wish line: "Needs", "Would love", …), the flat `hints` list is rebuilt
 * from them so both always match. `exact` is always empty (kept for the stored shape).
 */
export function validateHints(h) {
  const clip = list => (Array.isArray(list) ? list : []).map(x => String(x).trim().slice(0, 160)).filter(Boolean);
  let left = MAX_HINTS;
  const groups = (Array.isArray(h?.groups) ? h.groups : []).slice(0, MAX_GROUPS)
    .map(g => {
      const hints = clip(g?.hints).slice(0, left);
      left -= hints.length;
      return { label: String(g?.label || "").trim().slice(0, 40), hints };
    })
    .filter(g => g.hints.length);
  const hints = groups.length ? groups.flatMap(g => g.hints) : clip(h?.hints).slice(0, MAX_HINTS);

  if (hints.length === 0) return { error: "There are no hints left — you need at least one." };
  return { hints: groups.length ? { hints, groups, exact: [] } : { hints, exact: [] } };
}
