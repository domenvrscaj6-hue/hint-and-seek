// lib/emails.js
// Occasion-themed wish-list emails, the "get a hint" invite, and the sender
// confirmation email. Sending goes through Resend (env: RESEND_API_KEY, EMAIL_FROM).
// Wishes are listed with ✦ bullets, grouped by tag (Needs, Wants…); the optional note comes at the end.
// ("Exact Wishes" ✓ are only rendered for submissions stored before that tab was removed.)

const THEMES = {
  christmas: {
    emoji: "🎄",
    bg: "#f6f1e3", header: "#2f4432", headerText: "#f6f1e3",
    accent: "#a4443a", rule: "#d8c9a8",
    title: "A Christmas wish list",
    intro: (name) =>
      `The elves whispered, and <strong>${name}</strong> confirmed: here is what would make their Christmas. ` +
      `Pick whatever feels right — or let it spark an idea of your own.`,
    subject: (name) => `🎄 ${name} shared their Christmas wish list`
  },
  birthday: {
    emoji: "🎂",
    bg: "#f6f1e3", header: "#8a5a2b", headerText: "#f9f2e2",
    accent: "#a4443a", rule: "#e0d2b4",
    title: "A birthday wish list",
    intro: (name) =>
      `A birthday is coming up, and <strong>${name}</strong> wrote down what they'd love. ` +
      `No more guessing — the choice (and the surprise of which one) is all yours.`,
    subject: (name) => `🎂 ${name}'s birthday wish list`
  },
  valentine: {
    emoji: "💝",
    bg: "#f8efe9", header: "#7a2e3a", headerText: "#fbeee8",
    accent: "#a4443a", rule: "#e6cfc6",
    title: "A Valentine's wish list",
    intro: (name) =>
      `Valentine's Day is around the corner, and <strong>${name}</strong> left you a little list ` +
      `of what they'd love. The rest — and the bow — is up to you.`,
    subject: (name) => `💝 ${name} shared a Valentine's wish list`
  },
  other: {
    emoji: "🎁",
    bg: "#f6f1e3", header: "#3a2c1c", headerText: "#f6f1e3",
    accent: "#a4443a", rule: "#ddd0b2",
    title: "A wish list for you",
    intro: (name) =>
      `<strong>${name}</strong> shared what they'd love with you. ` +
      `Pick whatever feels right — or let it spark an idea of your own.`,
    subject: (name) => `🎁 ${name} shared their wish list`
  }
};

const SECTION_LABELS = {
  hints: "The wish list",
  exact: "Exact Wishes" // legacy, see header comment
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hintList(items, theme, bullet) {
  const bulletColor = bullet === "✓" ? "#5a7a4a" : "#a4443a";
  return items.map(h =>
    `<tr><td width="22" style="width:22px;padding:6px 0 6px 4px;color:${bulletColor};vertical-align:top;font-size:16px;">${bullet}</td>` +
    `<td style="padding:6px 0 6px 10px;font-size:17px;line-height:1.5;color:#3a2c1c;border-bottom:1px solid ${theme.rule};">${esc(h)}</td></tr>`
  ).join("");
}

/* groups ("Needs", "Would love", …) when the submission has them; older ones are one plain list */
function hintGroups(hints, theme) {
  const groups = Array.isArray(hints.groups) && hints.groups.length ? hints.groups : [{ label: "", hints: hints.hints }];
  return groups.filter(g => g.hints && g.hints.length).map(g => `
      ${g.label ? `<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${theme.accent};margin:16px 0 0;font-weight:bold;">${esc(g.label)}</div>` : ""}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${hintList(g.hints, theme, "✦")}</table>`).join("");
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

  // the wish list — ✦ star bullets
  if (hints.hints && hints.hints.length) {
    parts.push(`
      <h3 style="font-family:Georgia,serif;font-size:15px;letter-spacing:.14em;text-transform:uppercase;
                 color:${theme.accent};margin:28px 0 4px;">${SECTION_LABELS.hints}</h3>
      ${hintGroups(hints, theme)}
    `);
  }

  // Exact Wishes — ✓ checkmark bullets (legacy submissions only)
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

/* ---------- 1. wish-list email to a recipient (per recipient, with unsubscribe) ---------- */
export function buildHintEmail({ senderName, occasion, hints, specialNotes, unsubscribeUrl, hintsUrl }) {
  const theme = THEMES[occasion] || THEMES.other;
  const name = esc(senderName);

  const notesHtml = specialNotes ? `
      <div style="margin-top:30px;border:1px dashed ${theme.accent};padding:14px 16px;border-radius:3px;">
        <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:${theme.accent};margin-bottom:6px;">A note from ${name}</div>
        <div style="font-size:16px;font-style:italic;line-height:1.55;color:#3a2c1c;white-space:pre-wrap;">${esc(specialNotes)}</div>
      </div>` : "";

  const saveHtml = hintsUrl ? `
      <div style="text-align:center;margin:30px 0 4px;">
        <a href="${esc(hintsUrl)}" style="display:inline-block;background:${theme.accent};color:#fdf6e6;text-decoration:none;
           font-size:17px;padding:11px 28px;border-radius:5px;font-style:italic;">Save this list to your phone</a>
        <div style="font-size:13px;color:#8b8070;margin-top:8px;font-style:italic;">as a picture, to send to someone, or to copy</div>
      </div>` : "";

  const body = `
        <p style="font-size:17px;line-height:1.6;color:#5c4a33;margin:0;">${theme.intro(name)}</p>
        ${sectionsHtml(hints, theme)}
        ${notesHtml}
        ${saveHtml}
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
export function buildInviteEmail({ requesterName, requesterEmail, occasion, siteUrl, unsubscribeUrl }) {
  const theme = THEMES[occasion] || THEMES.other;
  const name = esc(requesterName);
  const emailAddr = requesterEmail ? esc(requesterEmail) : null;
  const occasionText = occasion === "christmas" ? "for Christmas"
    : occasion === "birthday" ? "for your birthday"
    : occasion === "valentine" ? "for Valentine's Day" : "for an upcoming occasion";
  // the requester is pre-filled as a recipient, so the list reaches them without extra typing
  const link = `${String(siteUrl).replace(/\/+$/, "")}/?flow=give&occasion=${encodeURIComponent(occasion)}` +
    (requesterEmail ? `&to=${encodeURIComponent(requesterEmail)}&from=${encodeURIComponent(requesterName)}` : "");

  const contactLine = emailAddr ? `
        <p style="font-size:15px;line-height:1.55;color:#8b8070;margin:16px 0 0;font-style:italic;">
          You can also reach ${name} directly at
          <a href="mailto:${emailAddr}" style="color:#a4443a;text-decoration:underline;">${emailAddr}</a>.
        </p>` : "";

  const body = `
        <p style="font-size:17px;line-height:1.65;color:#3a2c1c;margin:0;">
          <strong>${name}</strong> would love to find you the right gift ${occasionText} — but they'd rather not guess.
        </p>
        <p style="font-size:17px;line-height:1.65;color:#5c4a33;margin:16px 0 0;">
          Take three minutes and jot down what you'd like — sizes, colours, the lot.
          We tidy it into a neat list and send it straight to ${name}.
        </p>${contactLine}
        <div style="text-align:center;margin:32px 0 8px;">
          <a href="${link}" style="display:inline-block;background:${theme.accent};color:#fdf6e6;text-decoration:none;
             font-size:19px;padding:12px 34px;border-radius:5px;font-style:italic;">Write my wish list</a>
        </div>`;

  const footer = `
        Sent with Hint &amp; Seek at ${name}'s request. We use your email only to deliver this message.
        If you'd rather not, simply ignore this note — nothing else will happen.
        <a href="${unsubscribeUrl}" style="color:#a2937a;">Never want to hear from us again? One click.</a>`;

  return {
    subject: `${theme.emoji} ${requesterName} is asking for your wish list`,
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
             font-size:19px;padding:12px 34px;border-radius:5px;font-style:italic;">Confirm &amp; send the list</a>
        </div>
        <p style="margin-top:18px;font-size:14px;font-style:italic;color:#8b8070;text-align:center;">
          The link works once and expires in 48 hours.
        </p>
        <p style="margin-top:14px;font-size:14px;line-height:1.55;color:#8b8070;text-align:center;
           border-top:1px solid ${theme.rule};padding-top:14px;">
          <strong style="color:#5c4a33;">Heads up:</strong> Because our domain is still new, the email your people
          receive might land in their <strong>spam or junk folder</strong>. If they say they haven't received anything,
          ask them to check there — and mark it as "Not spam" so future emails arrive normally.
        </p>`;

  const footer = `
        You received this because your address was entered on Hint &amp; Seek.
        If this wasn't you, simply ignore this email — nothing will be sent to anyone.`;

  return { subject: `✉️ Confirm your wish list, ${senderName}`, html: shell(theme, "One click to go", body, footer) };
}

/* ---------- one-click unsubscribe headers (RFC 8058, Gmail / Yahoo) ---------- */
export function unsubscribeHeaders(url) {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

/* ---------- Resend ---------- */
export async function sendEmail({ to, subject, html, headers }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM; // e.g. "Hint & Seek <hints@yourdomain.com>"
  if (!key || !from) throw new Error("RESEND_API_KEY or EMAIL_FROM is not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to, subject, html, ...(headers ? { headers } : {}) })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}
