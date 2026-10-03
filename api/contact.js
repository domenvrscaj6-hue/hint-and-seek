// api/contact.js  (Vercel serverless function)
// GET → a contact card (vCard) for the address our emails come from (EMAIL_FROM).
// Linked from the emails as "Add Hint & Seek to your contacts": mail apps treat a sender in your
// contacts as trusted, so our emails land in the inbox (not spam / Promotions) far more often.
// No email client offers a button that moves mail to "Primary" — this is the closest honest thing.

export default function handler(req, res) {
  const from = String(process.env.EMAIL_FROM || "");
  const email = (from.match(/<([^>]+)>/) || [, from])[1].trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return res.status(404).send("Not configured");
  const card = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Hint & Seek",
    "ORG:Hint & Seek",
    `EMAIL;TYPE=INTERNET:${email}`,
    `URL:${String(process.env.SITE_URL || "https://www.hintandseek.com").replace(/\/+$/, "")}`,
    "END:VCARD",
    ""
  ].join("\r\n");
  res.setHeader("Content-Type", "text/vcard; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="hint-and-seek.vcf"');
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.status(200).send(card);
}
