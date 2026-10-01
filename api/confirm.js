// api/confirm.js  (Vercel serverless function)
// The sender opens the link in their confirmation email → a page with a
// "Send the hints" button (GET). Only pressing the button (POST) sends.
// Why two steps: mail security scanners (Outlook Safe Links, corporate
// filters…) open every link in an email automatically — a plain GET must
// never send anything.
// Fail-safe: an invalid, used or expired token sends nothing; if no email
// can be delivered, the submission goes back to pending so the link can be retried.

import { buildHintEmail, sendEmail, unsubscribeHeaders } from "../lib/emails.js";
import { selectRows, updateRows, blockedAmong } from "../lib/store.js";
import { unsubscribeUrl, siteUrlFrom } from "../lib/security.js";
import { track } from "../lib/analytics.js";

// `mark` = text in the round stamp; `extra` = optional trusted HTML (e.g. the confirm button)
function page(title, message, mark, extra = "") {
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
  .mark{width:110px;height:110px;margin:0 auto 20px;border:2.5px dashed #a4443a;border-radius:50%;
    display:flex;align-items:center;justify-content:center;color:#a4443a;transform:rotate(-8deg);
    font-size:22px;font-style:italic;}
  h1{font-size:30px;color:#3a2c1c;margin:0 0 12px;font-style:italic;}
  p{font-size:17px;line-height:1.6;color:#5c4a33;margin:0;}
  a{color:#a4443a;}
  button{margin-top:26px;background:#a4443a;color:#fdf6e6;border:0;border-radius:5px;cursor:pointer;
    font-family:inherit;font-size:19px;font-style:italic;padding:12px 34px;}
  button:disabled{opacity:.6;cursor:default;}
</style></head><body>
<div class="card"><div class="seal" aria-hidden="true">H</div>
  <div class="mark">${mark}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  ${extra}
  <p style="margin-top:22px;font-size:14px;"><a href="/">← back to Hint &amp; Seek</a></p>
</div></body></html>`;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const OK = "Sent!", ASK = "One click", BAD = "Hmm…";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const token = String(req.query?.token || "");

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send(page("Not allowed", "Please open the link straight from your email.", BAD));
  }
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return res.status(400).send(page("That link doesn't look right", "The confirmation link is incomplete or damaged. Please open it straight from your email.", BAD));
  }

  let claimed = false, delivered = false;
  try {
    const rows = await selectRows("hint_submissions", {
      select: "status,expires_at,recipients",
      token: `eq.${token}`
    });
    const found = rows[0];

    if (!found) {
      return res.status(404).send(page("Link not found", "This confirmation link doesn't exist. Nothing has been sent.", BAD));
    }
    if (found.status === "sent") {
      return res.status(200).send(page("Already done", "These hints were already confirmed and sent — no need to click twice. 🙂", OK));
    }
    if (found.status !== "pending" || new Date(found.expires_at) < new Date()) {
      return res.status(410).send(page("Link expired", "This link is no longer valid (links work once and expire after 48 hours). Nothing was sent — you can create the hints again on the site.", BAD));
    }

    // ---------- GET: only show the button, never send ----------
    if (req.method === "GET") {
      const n = found.recipients.length;
      const who = n === 1 ? "1 person" : `${n} people`;
      const form = `
  <form method="POST" action="/api/confirm?token=${token}" onsubmit="this.querySelector('button').disabled=true">
    <button type="submit">Send the hints</button>
  </form>`;
      return res.status(200).send(page("Ready when you are", `Your hints will go to ${who}. Nothing is sent until you press the button.`, ASK, form));
    }

    // ---------- POST: atomically claim the submission (pending → sent) ----------
    // Only one request can win this update, so a double click can't send twice.
    const claimedRows = await updateRows(
      "hint_submissions",
      { token: `eq.${token}`, status: "eq.pending" },
      { status: "sent" },
      { returning: true }
    );
    const sub = claimedRows[0];
    if (!sub) {
      return res.status(200).send(page("Already done", "These hints were already confirmed and sent — no need to click twice. 🙂", OK));
    }

    claimed = true;

    // Fail-safe: re-check the blocklist at send time.
    const blocked = await blockedAmong(sub.recipients);
    const recipients = sub.recipients.filter(r => !blocked.has(r));
    if (recipients.length === 0) {
      await updateRows("hint_submissions", { token: `eq.${token}` }, { status: "failed" });
      return res.status(422).send(page("Nothing to send", "Everyone on your list has opted out of Hint & Seek emails, so the hints could not be delivered.", BAD));
    }

    const siteUrl = siteUrlFrom(req);
    const results = await Promise.allSettled(
      recipients.map(to => {
        const unsubUrl = unsubscribeUrl(siteUrl, to);
        const { subject, html } = buildHintEmail({
          senderName: sub.sender_name,
          occasion: sub.occasion,
          hints: sub.masked_hints,
          specialNotes: sub.special_notes,
          unsubscribeUrl: unsubUrl
        });
        return sendEmail({ to, subject, html, headers: unsubscribeHeaders(unsubUrl) });
      })
    );
    const sent = results.filter(r => r.status === "fulfilled").length;
    const failedTo = recipients.filter((_, i) => results[i].status !== "fulfilled");
    results.forEach(r => { if (r.status !== "fulfilled") console.error("[confirm] delivery failed:", r.reason?.message); });

    if (sent === 0) {
      // release the claim → the sender can press the button again in a minute
      await updateRows("hint_submissions", { token: `eq.${token}` }, { status: "pending" }).catch(() => {});
      claimed = false;
      return res.status(502).send(page("Delivery hiccup", "The hints were confirmed but no email could be delivered right now. Nothing was lost — open the link again in a few minutes.", BAD));
    }

    delivered = true;
    // bookkeeping only — the emails are already out, so a failure here must not say "nothing was sent"
    await updateRows("hint_submissions", { token: `eq.${token}` }, { sent_count: sent })
      .catch(e => console.error("[confirm] sent_count not saved:", e.message));
    await track("hints_sent", { occasion: sub.occasion, sent });

    const who = sent === 1 ? "1 person" : `${sent} people`;
    const missed = failedTo.length
      ? ` We couldn't deliver to ${failedTo.map(esc).join(", ")} — please check ${failedTo.length === 1 ? "that address" : "those addresses"} and let them know yourself.`
      : "";
    return res.status(200).send(page("The hints are on their way", `Your hints were just mailed to ${who}.${missed} Your exact wishes stay private — happy gifting! 🎁`, OK));
  } catch (err) {
    console.error("[confirm]", err);
    // claimed but not delivered (e.g. the blocklist check failed) → release it, so the link still works
    if (claimed && !delivered) {
      await updateRows("hint_submissions", { token: `eq.${token}`, status: "eq.sent" }, { status: "pending" }).catch(() => {});
    }
    return res.status(500).send(page("Something went wrong", "We couldn't process the confirmation right now. Nothing was sent — please try the link again shortly.", BAD));
  }
}
