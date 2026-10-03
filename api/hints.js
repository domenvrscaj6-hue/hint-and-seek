// api/hints.js  (Vercel serverless function)
// "Save these hints" page, linked from every hint email (signed link, see hintsUrl() in
// lib/security.js). Shows the hints as a card that is ALSO a PNG picture (drawn on a canvas
// in the browser — no server-side image library), so people can keep it in their photos,
// send it to someone, or copy the text. The wisher's name is always on the card, because
// one person may collect cards from several people.
// Only already-masked hints are shown (the same content as the email). The page works as long
// as the submission is kept: sent submissions are deleted after 90 days (cleanup in schema.sql).

import { selectRows } from "../lib/store.js";
import { verifyHintsSig } from "../lib/security.js";
import { track } from "../lib/analytics.js";

const OCCASION_LABEL = {
  christmas: "Christmas gift hints",
  birthday: "Birthday gift hints",
  valentine: "Valentine's gift hints",
  other: "Gift hints"
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shell(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<meta name="theme-color" content="#2e2318">
<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=EB+Garamond:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<title>${title} — Hint &amp; Seek</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;background:#2e2318;color:#3a2c1c;font-family:'EB Garamond',Georgia,serif;
    display:flex;flex-direction:column;align-items:center;padding:28px 16px 48px}
  .wrap{width:100%;max-width:460px;text-align:center}
  .card{display:block;width:100%;height:auto;border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,.45);
    -webkit-touch-callout:default;background:#f3ead7}
  .card.loading{aspect-ratio:3/4}
  .tip{color:#cdbd9c;font-size:14px;font-style:italic;margin:12px 0 18px;line-height:1.45}
  .btns{display:flex;flex-direction:column;gap:10px}
  button{font-family:'Caveat',cursive;font-size:24px;font-weight:700;border:none;cursor:pointer;
    border-radius:4px 7px 5px 8px;padding:9px 20px 11px;display:flex;align-items:center;justify-content:center;gap:10px}
  .primary{background:#a4443a;color:#fdf6e6;box-shadow:0 3px 0 #7e332b}
  .secondary{background:#f3ead7;color:#3a2c1c;box-shadow:0 3px 0 #c9b896}
  button:active{transform:translateY(2px);box-shadow:none}
  button:focus-visible{outline:2px dashed #e6d9bd;outline-offset:3px}
  button svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .msg{min-height:22px;margin-top:12px;color:#e6d9bd;font-size:15px;font-style:italic}
  .home{margin-top:26px;font-size:14px}
  .home a{color:#cdbd9c}
  .box{background:#f3ead7;border-radius:4px;padding:36px 28px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
  h1{font-family:'Caveat',cursive;font-size:38px;margin-bottom:10px}
  .box p{font-size:17px;line-height:1.55;color:#5c4a33}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

function errorPage(title, message) {
  return shell(title, `<div class="box"><h1>${title}</h1><p>${message}</p></div>
  <p class="home"><a href="/">Hint &amp; Seek</a></p>`);
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).send(errorPage("Not allowed", "Please open the link from your email."));

  const id = String(req.query?.id || "");
  const sig = String(req.query?.sig || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyHintsSig(id, sig)) {
    return res.status(400).send(errorPage("That link doesn't look right", "Please open it straight from the email with the hints."));
  }

  try {
    const rows = await selectRows("hint_submissions", {
      select: "sender_name,occasion,masked_hints,special_notes,created_at,status",
      id: `eq.${id}`
    });
    const sub = rows[0];
    if (!sub || sub.status !== "sent") {
      return res.status(404).send(errorPage("These hints are gone",
        "We only keep hints for 90 days. The hints are still in the email you received."));
    }

    const data = {
      name: String(sub.sender_name || ""),
      label: OCCASION_LABEL[sub.occasion] || OCCASION_LABEL.other,
      date: new Date(sub.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      // groups ("Needs", "Would love", …) when present; older submissions are one plain list
      groups: (Array.isArray(sub.masked_hints?.groups) && sub.masked_hints.groups.length
        ? sub.masked_hints.groups
        : [{ label: "", hints: sub.masked_hints?.hints || [] }]
      ).map(g => ({ label: String(g.label || ""), hints: (g.hints || []).map(String) })).filter(g => g.hints.length),
      note: sub.special_notes ? String(sub.special_notes) : ""
    };
    await track("hints_page_view", { occasion: sub.occasion });

    // JSON inside <script>: escape "<" so no text can close the tag
    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    const title = `Gift hints from ${esc(data.name)}`;
    const body = `
  <img class="card loading" id="card" alt="${title}">
  <p class="tip">Press and hold the picture to save it, or use the buttons.</p>
  <div class="btns">
    <button class="primary" id="save" type="button"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg>Save as picture</button>
    <button class="secondary" id="share" type="button"><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-3-7-7-1z"/></svg>Send to someone</button>
    <button class="secondary" id="copy" type="button"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>Copy text</button>
  </div>
  <p class="msg" id="msg" aria-live="polite"></p>
  <p class="home"><a href="/">Make your own hints on Hint &amp; Seek</a></p>
  <script type="application/json" id="data">${json}</script>
  <script>${CLIENT_JS}</script>`;
    return res.status(200).send(shell(title, body));
  } catch (err) {
    console.error("[hints]", err);
    return res.status(500).send(errorPage("Something went wrong", "Please try the link again in a moment."));
  }
}

// Runs in the browser: draws the card on a canvas, shows it as an <img>, wires the buttons.
const CLIENT_JS = String.raw`
(function(){
  var d = JSON.parse(document.getElementById("data").textContent);
  var img = document.getElementById("card"), msg = document.getElementById("msg");
  var fileName = "gift-hints-" + d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".png";
  var blob = null;

  var text = d.label + " from " + d.name + " (" + d.date + ")\n" +
    d.groups.map(function(g){
      return (g.label ? g.label + ":\n" : "") + g.hints.map(function(h){ return "✦ " + h; }).join("\n");
    }).join("\n\n") +
    (d.note ? "\n\nA note from " + d.name + ": " + d.note : "") +
    "\n\n— via Hint & Seek, hintandseek.com";

  function say(t){ msg.textContent = t; }

  function wrap(ctx, str, maxW){
    var words = String(str).split(/\s+/), lines = [], line = "";
    words.forEach(function(w){
      var test = line ? line + " " + w : w;
      if(ctx.measureText(test).width > maxW && line){ lines.push(line); line = w; } else line = test;
    });
    if(line) lines.push(line);
    return lines;
  }

  function draw(){
    var W = 1080, P = 96, inner = W - 2 * P;
    var c = document.createElement("canvas"), ctx = c.getContext("2d");
    var HAND = "700 112px Caveat, 'Segoe Script', cursive";
    var BODY = "44px 'EB Garamond', Georgia, serif";
    var NOTE = "italic 38px 'EB Garamond', Georgia, serif";

    // measure first, then size the canvas
    ctx.font = HAND; var nameLines = wrap(ctx, d.name, inner - 40);
    ctx.font = BODY;
    var groups = d.groups.map(function(g){ return { label: g.label, items: g.hints.map(function(h){ return wrap(ctx, h, inner - 56); }) }; });
    ctx.font = NOTE; var noteLines = d.note ? wrap(ctx, d.note, inner - 60) : [];
    var H = 150 + 70 + nameLines.length * 112 + 64 + 60;
    groups.forEach(function(g){ if(g.label) H += 56; g.items.forEach(function(l){ H += l.length * 58 + 34; }); });
    if(noteLines.length) H += 70 + noteLines.length * 50 + 60;
    H += 130;
    c.width = W; c.height = H;

    // desk + paper
    ctx.fillStyle = "#2e2318"; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    ctx.fillStyle = "#f3ead7"; ctx.fillRect(36, 36, W - 72, H - 72); ctx.restore();
    var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75);
    g.addColorStop(0, "rgba(120,90,40,0)"); g.addColorStop(1, "rgba(120,90,40,.16)");
    ctx.fillStyle = g; ctx.fillRect(36, 36, W - 72, H - 72);

    // wax seal, top right
    ctx.save(); ctx.translate(W - 150, 150); ctx.rotate(10 * Math.PI / 180);
    var sg = ctx.createRadialGradient(-18, -22, 4, 0, 0, 66);
    sg.addColorStop(0, "#c0594d"); sg.addColorStop(.5, "#a4443a"); sg.addColorStop(1, "#85352c");
    ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, 62, 0, 2 * Math.PI); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(110,40,33,.75)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 50, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = "#fdf6e6"; ctx.font = "600 64px 'EB Garamond', Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("H", 0, 4); ctx.restore();

    var y = 150;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    // label + date
    ctx.fillStyle = "#a4443a"; ctx.font = "600 30px 'EB Garamond', Georgia, serif";
    if("letterSpacing" in ctx) ctx.letterSpacing = "5px";
    ctx.fillText(d.label.toUpperCase(), P, y);
    if("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    y += 70;
    // the wisher's name, big and handwritten
    ctx.fillStyle = "#3a2c1c"; ctx.font = HAND;
    nameLines.forEach(function(l){ y += 92; ctx.fillText(l, P, y); y += 20; });
    ctx.fillStyle = "#76695a"; ctx.font = "italic 34px 'EB Garamond', Georgia, serif";
    y += 50; ctx.fillText(d.date, P, y);
    // squiggle
    ctx.strokeStyle = "#a4443a"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.beginPath();
    ctx.moveTo(P, y + 30); ctx.bezierCurveTo(P + 90, y + 18, P + 170, y + 44, P + 260, y + 28); ctx.stroke();
    y += 60;
    // hints
    groups.forEach(function(g){
      if(g.label){
        y += 76;
        ctx.fillStyle = "#a4443a"; ctx.font = "600 28px 'EB Garamond', Georgia, serif";
        if("letterSpacing" in ctx) ctx.letterSpacing = "4px";
        ctx.fillText(g.label.toUpperCase(), P, y);
        if("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        y -= 20;
      }
      g.items.forEach(drawHint);
    });
    function drawHint(lines){
      y += 34;
      ctx.fillStyle = "#a4443a"; ctx.font = "34px Georgia, serif"; ctx.fillText("✦", P, y + 44);
      ctx.fillStyle = "#3a2c1c"; ctx.font = BODY;
      lines.forEach(function(l, i){ ctx.fillText(l, P + 56, y + 44 + i * 58); });
      y += lines.length * 58;
      ctx.strokeStyle = "#d8c9a8"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(P + 56, y + 20); ctx.lineTo(W - P, y + 20); ctx.stroke();
    }
    // note
    if(noteLines.length){
      y += 70;
      var boxTop = y - 10, boxH = 70 + noteLines.length * 50;
      ctx.setLineDash([10, 8]); ctx.strokeStyle = "#a4443a"; ctx.lineWidth = 2;
      ctx.strokeRect(P, boxTop, inner, boxH); ctx.setLineDash([]);
      ctx.fillStyle = "#a4443a"; ctx.font = "600 26px 'EB Garamond', Georgia, serif";
      ctx.fillText("A NOTE FROM " + d.name.toUpperCase(), P + 30, boxTop + 44);
      ctx.fillStyle = "#3a2c1c"; ctx.font = NOTE;
      noteLines.forEach(function(l, i){ ctx.fillText(l, P + 30, boxTop + 96 + i * 50); });
      y = boxTop + boxH;
    }
    // footer
    ctx.fillStyle = "#8b8070"; ctx.font = "italic 30px 'EB Garamond', Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("hintandseek.com", W / 2, H - 80);
    return c;
  }

  function render(){
    var c = draw();
    img.src = c.toDataURL("image/png");
    img.classList.remove("loading");
    c.toBlob(function(b){ blob = b; }, "image/png");
  }

  // wait for the web fonts (max 2.5 s), then draw
  var fontsReady = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load("700 112px Caveat"), document.fonts.load("44px 'EB Garamond'"),
                   document.fonts.load("italic 38px 'EB Garamond'"), document.fonts.load("600 30px 'EB Garamond'")])
    : Promise.resolve();
  Promise.race([fontsReady, new Promise(function(r){ setTimeout(r, 2500); })]).then(render, render);

  function pngFile(){ return blob && window.File ? new File([blob], fileName, { type: "image/png" }) : null; }
  function canShareFile(f){ try { return !!(f && navigator.canShare && navigator.canShare({ files: [f] })); } catch(e){ return false; } }

  function download(){
    var a = document.createElement("a");
    a.href = blob ? URL.createObjectURL(blob) : img.src; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    say("Saved — look in your photos or downloads.");
  }

  // iPhone/iPad: the share sheet has "Save Image" (goes to Photos); elsewhere a download is simpler
  document.getElementById("save").addEventListener("click", function(){
    var f = pngFile(), ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if(ios && canShareFile(f)){
      navigator.share({ files: [f] }).then(function(){ say("Saved."); }, function(){});
    } else download();
  });

  document.getElementById("share").addEventListener("click", function(){
    var f = pngFile();
    if(canShareFile(f)){
      navigator.share({ files: [f], text: text }).catch(function(){});
    } else if(navigator.share){
      navigator.share({ title: "Gift hints from " + d.name, text: text }).catch(function(){});
    } else {
      copy(); say("Copied — paste it into a message to send it.");
    }
  });

  function copy(){
    function fallback(){
      var t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", "");
      t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); say("Copied."); } catch(e){ say("Couldn't copy — select the text in the email instead."); }
      t.remove();
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ say("Copied."); }, fallback);
    } else fallback();
  }
  document.getElementById("copy").addEventListener("click", copy);
})();
`;
