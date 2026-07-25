// api/unsubscribe.js  (Vercel serverless function)
// One-click opt-out. The link is HMAC-signed so nobody can unsubscribe
// someone else by guessing; after this, no Hint & Seek email reaches
// the address (checked before every send).

import { verifyEmailSig } from "../lib/security.js";
import { addToBlocklist } from "../lib/store.js";
import { EMAIL_RE } from "../lib/validate.js";

function page(title, message) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title} — Hint &amp; Seek</title>
<style>
  body{min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;
    font-family:Georgia,'Times New Roman',serif;background:#2e2318;padding:20px;}
  .card{max-width:520px;background:#f3ead7;border-radius:4px;padding:44px 40px;text-align:center;
    box-shadow:0 12px 34px rgba(0,0,0,.45);}
  h1{font-size:30px;color:#3a2c1c;margin:0 0 12px;font-style:italic;}
  p{font-size:17px;line-height:1.6;color:#5c4a33;margin:0;}
</style></head><body>
<div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const email = String(req.query?.email || "").trim().toLowerCase();
  const sig = String(req.query?.sig || "");

  if (!EMAIL_RE.test(email) || !verifyEmailSig(email, sig)) {
    return res.status(400).send(page("That link doesn't look right", "The opt-out link is incomplete or damaged. Please open it straight from the email you received."));
  }

  try {
    await addToBlocklist(email);
    return res.status(200).send(page("You're all set", `${email} will never receive a Hint &amp; Seek email again. Sorry for the bother, and all the best. 👋`));
  } catch (err) {
    console.error("[unsubscribe]", err);
    return res.status(500).send(page("Something went wrong", "We couldn't process the opt-out right now — please try the link again shortly."));
  }
}
