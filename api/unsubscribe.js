// api/unsubscribe.js  (Vercel serverless function)
// Opt-out. The link is HMAC-signed so nobody can unsubscribe someone else
// by guessing; after this, no Hint & Seek email reaches the address
// (checked before every send).
//   GET  → a page with an "Unsubscribe" button (mail scanners open every
//          link automatically, so a GET alone must never unsubscribe)
//   POST → adds the address to the blocklist. Also used by Gmail/Yahoo's
//          one-click "Unsubscribe" (RFC 8058 List-Unsubscribe-Post header).

import { verifyEmailSig } from "../lib/security.js";
import { addToBlocklist } from "../lib/store.js";
import { EMAIL_RE } from "../lib/validate.js";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(title, message, extra = "") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${title} — Hint &amp; Seek</title>
<style>
  .card{position:relative;}
  .seal{position:absolute;top:-20px;right:-20px;width:62px;height:62px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;transform:rotate(10deg);
    background:radial-gradient(circle at 36% 30%,#c0594d 0%,#a4443a 48%,#85352c 100%);
    box-shadow:0 3px 8px rgba(0,0,0,.35);color:#fdf6e6;font-weight:bold;font-size:30px;line-height:1;}
  .seal::before{content:"";position:absolute;inset:6px;border-radius:50%;border:1.5px solid rgba(110,40,33,.75);}
  @media (max-width:560px){.seal{width:48px;height:48px;font-size:23px;top:-12px;right:-8px}}
  body{min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;
    font-family:Georgia,'Times New Roman',serif;background:#2e2318;padding:20px;}
  .card{max-width:520px;background:#f3ead7;border-radius:4px;padding:44px 40px;text-align:center;
    box-shadow:0 12px 34px rgba(0,0,0,.45);}
  h1{font-size:30px;color:#3a2c1c;margin:0 0 12px;font-style:italic;}
  p{font-size:17px;line-height:1.6;color:#5c4a33;margin:0;word-break:break-word;}
  button{margin-top:26px;background:#a4443a;color:#fdf6e6;border:0;border-radius:5px;cursor:pointer;
    font-family:inherit;font-size:19px;font-style:italic;padding:12px 34px;}
</style></head><body>
<div class="card"><div class="seal" aria-hidden="true">H</div><h1>${title}</h1><p>${message}</p>${extra}</div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const email = String(req.query?.email || "").trim().toLowerCase();
  const sig = String(req.query?.sig || "");

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send(page("Not allowed", "Please open the link straight from the email you received."));
  }
  if (!EMAIL_RE.test(email) || !verifyEmailSig(email, sig)) {
    return res.status(400).send(page("That link doesn't look right", "The opt-out link is incomplete or damaged. Please open it straight from the email you received."));
  }

  if (req.method === "GET") {
    const action = `/api/unsubscribe?email=${encodeURIComponent(email)}&sig=${encodeURIComponent(sig)}`;
    const form = `
  <form method="POST" action="${esc(action)}">
    <button type="submit">Unsubscribe</button>
  </form>`;
    return res.status(200).send(page("Stop Hint &amp; Seek emails?",
      `Press the button and <strong>${esc(email)}</strong> will never receive a Hint &amp; Seek email again.`, form));
  }

  try {
    await addToBlocklist(email);
    return res.status(200).send(page("You're all set", `${esc(email)} will never receive a Hint &amp; Seek email again. Sorry for the bother, and all the best. 👋`));
  } catch (err) {
    console.error("[unsubscribe]", err);
    return res.status(500).send(page("Something went wrong", "We couldn't process the opt-out right now — please try again shortly."));
  }
}
