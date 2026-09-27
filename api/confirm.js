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
import { unsubscribeUrl } from "../lib/security.js";
import { track } from "../lib/analytics.js";

// `mark` = text in the round stamp; `extra` = optional trusted HTML (e.g. the confirm button)
function page(title, message, mark, extra = "") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<title>${title} — Hint &amp; Seek</title>
<style>
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
<div class="card">
  <div class="mark">${mark}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  ${extra}
  <p style="margin-top:22px;font-size:14px;"><a href="/">← back to Hint &amp; Seek</a></p>
</div></body></html>`;
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
    const claimed = await updateRows(
      "hint_submissions",
      { token: `eq.${token}`, status: "eq.pending" },
      { status: "sent" },
      { returning: true }
    );
    const sub = claimed[0];
    if (!sub) {
      return res.status(200).send(page("Already done", "These hints were already confirmed and sent — no need to click twice. 🙂", OK));
    }

    // Fail-safe: re-check the blocklist at send time.
    const blocked = await blockedAmong(sub.recipients);
    const recipients = sub.recipients.filter(r => !blocked.has(r));
    if (recipients.length === 0) {
      await updateRows("hint_submissions", { token: `eq.${token}` }, { status: "failed" });
      return res.status(422).send(page("Nothing to send", "Everyone on your list has opted out of Hint & Seek emails, so the hints could not be delivered.", BAD));
    }

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
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

    if (sent === 0) {
      // release the claim → the sender can press the button again in a minute
      await updateRows("hint_submissions", { token: `eq.${token}` }, { status: "pending" }).catch(() => {});
      return res.status(502).send(page("Delivery hiccup", "The hints were confirmed but no email could be delivered right now. Nothing was lost — open the link again in a few minutes.", BAD));
    }

    await updateRows("hint_submissions", { token: `eq.${token}` }, { sent_count: sent });
    await track("hints_sent", { occasion: sub.occasion, sent });

    const who = sent === 1 ? "1 person" : `${sent} people`;
    return res.status(200).send(page("The hints are on their way", `Your hints were just mailed to ${who}. Your exact wishes stay private — happy gifting! 🎁`, OK));
  } catch (err) {
    console.error("[confirm]", err);
    return res.status(500).send(page("Something went wrong", "We couldn't process the confirmation right now. Nothing was sent — please try the link again shortly.", BAD));
  }
}
