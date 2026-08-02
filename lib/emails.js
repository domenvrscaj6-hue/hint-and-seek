// lib/emails.js
// Occasion-themed hint emails, the "get a hint" invite, and the sender
// confirmation email. Sending goes through Resend (env: RESEND_API_KEY, EMAIL_FROM).
// Two-section layout: "Hints & Surprises" (✦) and "Exact Wishes" (✓).

const THEMES = {
  christmas: {
    emoji: "🎄",
    bg: "#f6f1e3", header: "#2f4432", headerText: "#f6f1e3",
    accent: "#a4443a", rule: "#d8c9a8",
    title: "A few Christmas gift hints",
    intro: (name) =>
      `The elves whispered, and <strong>${name}</strong> confirmed: here are a few directions ` +
      `that would make their Christmas — without spoiling the surprise of what you actually pick.`,
    subject: (name) => `🎄 ${name} left you a few Christmas gift hints`
  },
  birthday: {
    emoji: "🎂",
    bg: "#f6f1e3", header: "#8a5a2b", headerText: "#f9f2e2",
    accent: "#a4443a", rule: "#e0d2b4",
    title: "Birthday gift hints",
    intro: (name) =>
      `A birthday is coming up, and <strong>${name}</strong> shared a few gentle directions — ` +
      `no exact products, just enough to point you the right way. The choice (and the surprise) is all yours.`,
    subject: (name) => `🎂 A few birthday gift hints from ${name}`
  },
  other: {
    emoji: "🎁",
    bg: "#f6f1e3", header: "#3a2c1c", headerText: "#f6f1e3",
    accent: "#a4443a", rule: "#ddd0b2",
    title: "A few gift hints",
    intro: (name) =>
      `<strong>${name}</strong> shared a few gift directions with you — hints, not a shopping list. ` +
      `What you make of them is entirely up to you.`,
    subject: (name) => `🎁 ${name} left you a few gift hints`
  }
};

const SECTION_LABELS = {
  hints: "Hints & Surprises",
  exact: "Exact Wishes"
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hintList(items, theme, bullet) {
  const bulletColor = bullet === "✓" ? "#5a7a4a" : "#a4443a";
  return items.map(h =>
    `<tr><td style="padding:6px 0 6px 4px;color:${bulletColor};vertical-align:top;font-size:16px;">${bullet}</td>` +
    `<td style="padding:6px 0 6px 10px;font-size:17px;line-height:1.5;color:#3a2c1c;border-bottom:1px solid ${theme.rule};">${esc(h)}</td></tr>`
  ).join("");
}

function shell(theme, headerTitle, bodyHtml, footerHtml) {
  return `
  <div style="background:#2e2318;padding:28px 12px;">
    <div style="max-width:600px;margin:0 auto;background:${theme.bg};border-radius:4px;overflow:hidden;
                font-family:Georgia,'Times New Roman',serif;box-shadow:0 8px 24px rgba(0,0,0,.4);">
      <div style="background:${theme.header};padding:26px 32px;text-align:center;">
        <div style="font-size:34px;line-height:1;">${theme.emoji}</div>
        <div style="font-size:26px;color:${theme.headerText};margin-top:8px;font-style:italic;">${headerTitle}</div>
      </div>
      <div style="padding:30px 34px 34px;">${bodyHtml}</div>
      <div style="padding:16px 34px 22px;border-top:1px solid ${theme.rule};font-size:12px;color:#a2937a;line-height:1.5;">
        ${footerHtml}
      </div>
    </div>
  </div>`;
}

function sectionsHtml(hints, theme) {
  const parts = [];

  // Hints & Surprises — ✦ star bullets
  if (hints.hints && hints.hints.length) {
    parts.push(`
      <h3 style="font-family:Georgia,serif;font-size:15px;letter-spacing:.14em;text-transform:uppercase;
                 color:${theme.accent};margin:28px 0 4px;">${SECTION_LABELS.hints}</h3>
      <p style="font-size:14px;font-style:italic;color:#8b8070;margin:0 0 8px;">These are gentle hints — the exact wishes stay private.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${hintList(hints.hints, theme, "✦")}</table>
    `);
  }

  // Exact Wishes — ✓ checkmark bullets
  if (hints.exact && hints.exact.length) {
    parts.push(`
      <h3 style="font-family:Georgia,serif;font-size:15px;letter-spacing:.14em;text-transform:uppercase;
                 color:#5a7a4a;margin:28px 0 4px;">${SECTION_LABELS.exact}</h3>
      <p style="font-size:14px;font-style:italic;color:#8b8070;margin:0 0 8px;">These are exactly what they asked for — no guessing needed.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${hintList(hints.exact, theme, "✓")}</table>
    `);
  }

  return parts.join("");
}

/* ---------- 1. hint email to a recipient (per recipient, with unsubscribe) ---------- */
export function buildHintEmail({ senderName, occasion, hints, specialNotes, unsubscribeUrl }) {
  const theme = THEMES[occasion] || THEMES.other;
  const name = esc(senderName);

  const notesHtml = specialNotes ? `
      <div style="margin-top:30px;border:1px dashed ${theme.accent};padding:14px 16px;border-radius:3px;">
        <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:${theme.accent};margin-bottom:6px;">A note from ${name}</div>
        <div style="font-size:16px;font-style:italic;line-height:1.55;color:#3a2c1c;white-space:pre-wrap;">${esc(specialNotes)}</div>
      </div>` : "";

  const body = `
        <p style="font-size:17px;line-height:1.6;color:#5c4a33;margin:0;">${theme.intro(name)}</p>
        ${sectionsHtml(hints, theme)}
        ${notesHtml}
        <p style="margin-top:32px;font-size:15px;font-style:italic;color:#8b8070;line-height:1.55;">
          No pressure and no obligation — this note is just here in case you were wondering. ${theme.emoji}
        </p>`;

  const footer = `
        Sent with Hint &amp; Seek because ${name} entered your address. We use your email only to deliver
        this message and don't share it with anyone.
        <a href="${unsubscribeUrl}" style="color:#a2937a;">Don't want notes like this? One click and we'll never write again.</a>`;

  return { subject: theme.subject(senderName), html: shell(theme, theme.title, body, footer) };
}

/* ---------- 2. invite email ("get a hint" / pull flow) ---------- */
export function buildInviteEmail({ requesterName, occasion, siteUrl, unsubscribeUrl }) {
  const theme = THEMES[occasion] || THEMES.other;
  const name = esc(requesterName);
  const occasionText = occasion === "christmas" ? "for Christmas"
    : occasion === "birthday" ? "for your birthday" : "for an upcoming occasion";
  const link = `${siteUrl}?flow=give&occasion=${occasion}`;

  const body = `
        <p style="font-size:17px;line-height:1.65;color:#3a2c1c;margin:0;">
          <strong>${name}</strong> would love to find you the right gift ${occasionText} — but they'd rather not guess.
        </p>
        <p style="font-size:17px;line-height:1.65;color:#5c4a33;margin:16px 0 0;">
          Take three minutes and jot down a few things you'd like.
          You choose what stays exact and what gets turned into gentle hints —
          <em>${name} only sees what you decide to share</em>.
        </p>
        <div style="text-align:center;margin:32px 0 8px;">
          <a href="${link}" style="display:inline-block;background:${theme.accent};color:#fdf6e6;text-decoration:none;
             font-size:19px;padding:12px 34px;border-radius:5px;font-style:italic;">Share a few hints</a>
        </div>`;

  const footer = `
        Sent with Hint &amp; Seek at ${name}'s request. We use your email only to deliver this message.
        If you'd rather not, simply ignore this note — nothing else will happen.
        <a href="${unsubscribeUrl}" style="color:#a2937a;">Never want to hear from us again? One click.</a>`;

  return {
    subject: `${theme.emoji} ${requesterName} is asking you for a few gift hints`,
    html: shell(theme, "Someone wants to get your gift right", body, footer)
  };
}

/* ---------- 3. confirmation email to the sender (double opt-in) ---------- */
export function buildConfirmEmail({ senderName, occasion, recipients, hints, specialNotes, confirmUrl }) {
  const theme = THEMES[occasion] || THEMES.other;
  const name = esc(senderName);

  const recipientsHtml = recipients.map(r =>
    `<span style="display:inline-block;background:#eadfc4;border:1px solid ${theme.rule};border-radius:3px;
       padding:2px 8px;margin:2px;font-size:14px;color:#5c4a33;">${esc(r)}</span>`).join(" ");

  const notesHtml = specialNotes ? `
      <p style="margin-top:18px;font-size:15px;color:#5c4a33;"><em>Your note at the end:</em> ${esc(specialNotes)}</p>` : "";

  const body = `
        <p style="font-size:17px;line-height:1.65;color:#3a2c1c;margin:0;">
          Hi ${name} — you're one click away. Below is exactly what will be sent, and to whom.
          <strong>Nothing goes out until you confirm.</strong>
        </p>
        <h3 style="font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:${theme.accent};margin:24px 0 8px;">Going to</h3>
        <div>${recipientsHtml}</div>
        ${sectionsHtml(hints, theme)}
        ${notesHtml}
        <div style="text-align:center;margin:34px 0 8px;">
          <a href="${confirmUrl}" style="display:inline-block;background:${theme.accent};color:#fdf6e6;text-decoration:none;
             font-size:19px;padding:12px 34px;border-radius:5px;font-style:italic;">Confirm &amp; send the hints</a>
        </div>
        <p style="margin-top:18px;font-size:14px;font-style:italic;color:#8b8070;text-align:center;">
          The link works once and expires in 48 hours.
        </p>`;

  const footer = `
        You received this because your address was entered on Hint &amp; Seek.
        If this wasn't you, simply ignore this email — nothing will be sent to anyone.`;

  return { subject: `✉️ Confirm your gift hints, ${senderName}`, html: shell(theme, "One click to go", body, footer) };
}

/* ---------- Resend ---------- */
export async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM; // e.g. "Hint & Seek <hints@yourdomain.com>"
  if (!key || !from) throw new Error("RESEND_API_KEY or EMAIL_FROM is not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to, subject, html })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}
