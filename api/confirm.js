// api/confirm.js  (Vercel serverless function)
// The sender clicks the link in their confirmation email → hints are sent.
// Fail-safe: an invalid, used or expired token sends nothing; if no email
// can be delivered, the submission stays pending so the link can be retried.

import { buildHintEmail, sendEmail } from "../lib/emails.js";
import { selectRows, updateRows, blockedAmong } from "../lib/store.js";
import { unsubscribeUrl } from "../lib/security.js";

function page(title, message, ok) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title} — Hint &amp; Seek</title>
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
</style></head><body>
<div class="card">
  <div class="mark">${ok ? "Sent!" : "Hmm…"}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <p style="margin-top:22px;font-size:14px;"><a href="/">← back to Hint &amp; Seek</a></p>
</div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const token = String(req.query?.token || "");

  if (!/^[a-f0-9]{48}$/.test(token)) {
    return res.status(400).send(page("That link doesn't look right", "The confirmation link is incomplete or damaged. Please open it straight from your email.", false));
  }

  try {
    const rows = await selectRows("hint_submissions", {
      select: "*",
      token: `eq.${token}`
    });
    const sub = rows[0];

    if (!sub) {
      return res.status(404).send(page("Link not found", "This confirmation link doesn't exist. Nothing has been sent.", false));
    }
    if (sub.status === "sent") {
      return res.status(200).send(page("Already done", "These hints were already confirmed and sent — no need to click twice. 🙂", true));
    }
    if (sub.status !== "pending" || new Date(sub.expires_at) < new Date()) {
      return res.status(410).send(page("Link expired", "This link is no longer valid (links work once and expire after 48 hours). Nothing was sent — you can create the hints again on the site.", false));
    }

    // Fail-safe: re-check the blocklist at send time.
    const blocked = await blockedAmong(sub.recipients);
    const recipients = sub.recipients.filter(r => !blocked.has(r));
    if (recipients.length === 0) {
      await updateRows("hint_submissions", { token: `eq.${token}` }, { status: "failed" });
      return res.status(422).send(page("Nothing to send", "Everyone on your list has opted out of Hint & Seek emails, so the hints could not be delivered.", false));
    }

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const results = await Promise.allSettled(
      recipients.map(to => {
        const { subject, html } = buildHintEmail({
          senderName: sub.sender_name,
          occasion: sub.occasion,
          hints: sub.masked_hints,
          specialNotes: sub.special_notes,
          unsubscribeUrl: unsubscribeUrl(siteUrl, to)
        });
        return sendEmail({ to, subject, html });
      })
    );
    const sent = results.filter(r => r.status === "fulfilled").length;

    if (sent === 0) {
      // stays pending → the sender can click the link again in a minute
      return res.status(502).send(page("Delivery hiccup", "The hints were confirmed but no email could be delivered right now. Nothing was lost — try the link again in a few minutes.", false));
    }

    await updateRows("hint_submissions", { token: `eq.${token}` }, { status: "sent", sent_count: sent });

    const who = sent === 1 ? "1 person" : `${sent} people`;
    return res.status(200).send(page("The hints are on their way", `Your hints were just mailed to ${who}. Your exact wishes stay private — happy gifting! 🎁`, true));
  } catch (err) {
    console.error("[confirm]", err);
    return res.status(500).send(page("Something went wrong", "We couldn't process the confirmation right now. Nothing was sent — please try the link again shortly.", false));
  }
}
