// api/feedback.js  (Vercel serverless function)
// Receives user feedback (suggestion, bug, other) and sends it
// to the site owner via email using the existing Resend setup.

import { sendEmail } from "../lib/emails.js";

const VALID_TYPES = ["suggestion", "bug", "other"];
const TYPE_LABELS = { suggestion: "💡 Suggestion", bug: "🐛 Bug Report", other: "💬 Other" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, message } = req.body || {};

  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: "Invalid feedback type." });
  }
  const msg = String(message || "").trim().slice(0, 2000);
  if (!msg) {
    return res.status(400).json({ error: "Please write a message." });
  }

  const feedbackTo = process.env.FEEDBACK_TO || process.env.EMAIL_FROM;
  if (!feedbackTo) {
    console.error("[feedback] No FEEDBACK_TO or EMAIL_FROM configured");
    return res.status(500).json({ error: "Feedback is not configured yet." });
  }

  try {
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const html = `
    <div style="background:#2e2318;padding:28px 12px;">
      <div style="max-width:560px;margin:0 auto;background:#f3ead7;border-radius:4px;overflow:hidden;
                  font-family:Georgia,'Times New Roman',serif;box-shadow:0 8px 24px rgba(0,0,0,.4);">
        <div style="background:#3a2c1c;padding:20px 28px;text-align:center;">
          <div style="font-size:24px;color:#f3ead7;font-style:italic;">Hint &amp; Seek Feedback</div>
        </div>
        <div style="padding:24px 28px 28px;">
          <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#a4443a;margin-bottom:8px;">
            ${TYPE_LABELS[type]}
          </div>
          <div style="font-size:17px;line-height:1.6;color:#3a2c1c;white-space:pre-wrap;border-left:3px solid #d8c9a8;padding-left:14px;">
            ${esc(msg)}
          </div>
          <div style="margin-top:20px;font-size:13px;color:#8b8070;">
            Sent from Hint &amp; Seek at ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC
          </div>
        </div>
      </div>
    </div>`;

    await sendEmail({
      to: feedbackTo,
      subject: `${TYPE_LABELS[type]} — Hint & Seek feedback`,
      html
    });

    console.log(`[feedback] ${type}: ${msg.slice(0, 80)}…`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[feedback]", err);
    return res.status(500).json({ error: "Couldn't send feedback — please try again." });
  }
}
