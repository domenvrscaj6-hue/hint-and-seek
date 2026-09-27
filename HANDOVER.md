# HANDOVER — Hint & Seek

> **Purpose of this file:** everything a developer or an AI assistant needs to continue
> this project without any prior conversation context. If you are an AI assistant:
> read this file and README.md fully before changing anything, then follow
> "Working rules" at the bottom.

## 1. What this project is

Hint & Seek is a small web app that solves gift-giving two ways:

- **Give a hint (push):** a person writes their wishes (specific is good — brands, models,
  sizes) and chooses recipients and an occasion (Christmas / Birthday / Other). An LLM
  (Google Gemini) masks the wishes into gentle, brand-free hints; recipients never see the
  raw text. The person reviews and edits the hints, confirms via an email link, and only
  then do recipients get a themed email.
  - The optional **"Anything specific?"** note (stored as `special_notes`) is the ONLY
    part sent word-for-word, at the end of the email — e.g. "Please, no scented candles
    this year" or a wish that doesn't need to be a surprise.
  - Masking is the whole product. There used to be an "Exact Wishes" tab that bypassed
    the AI; it was removed in September 2026 on purpose. Don't bring it back.
- **Get a hint (pull):** a gift-giver enters their own name + email and the email of the
  person they're shopping for; that person receives a friendly invite to fill in the
  Give flow. The invite link (`?flow=give&occasion=…&to=<requester>&from=<name>`)
  pre-fills the requester as a recipient, so the hints reach them automatically.
  Nobody imposes a wishlist — hints arrive only on request.

The unique product bet: existing wishlist apps show givers the exact items; here givers
see only hints, so choosing the gift stays theirs and the surprise survives.

## 2. Current state (September 2026) — DONE

- Vintage "old paper on a wooden desk" single-page frontend (`index.html`):
  - landing choice cards (Give / Get) + on-sheet "how it works" (3 numbered stamps)
    and a before → after example of a masked wish
  - give form in two groups ("From you, to them" / "What you wish for"): name + sender
    email side by side, recipient chips, occasion, one wishes box with "+" inspiration
    tags, optional "Anything specific?" note
  - preview step with inline editing (add / edit / delete) of the hints
  - get form (requester name + email, target email, occasion)
  - success view
  - floating feedback widget (speech-bubble button → suggestion / bug / other)
  - icons are an inline SVG sprite (`<symbol>`s at the top of `<body>`), no emoji in the UI;
    views fade in on switch, the success postmark "stamps" down (both off with
    `prefers-reduced-motion`); a tiny head script hides the sheet until fonts load (max 1.2 s)
  - meta description, `theme-color`, OG/Twitter tags; share image `og-image.png` (1200×630)
  - works as a static preview without backend ("preview mode")
- Backend (Vercel serverless, zero npm dependencies, plain `fetch` everywhere):
  - `api/mask.js` — wishes → Gemini → hints (+ brand list)
  - `api/give-hint.js` — strict validation, leak re-check, blocklist, stores to `pending`,
    confirmation email to sender
  - `api/confirm.js` — GET shows a button, POST sends the hint emails, marks `sent`
  - `api/get-hint.js` — pull invite (stores requester name + email)
  - `api/unsubscribe.js` — HMAC-signed opt-out (GET shows a button, POST) → blocklist
  - `api/feedback.js` — feedback widget → email to the site owner
- Gemini with **automatic model fallback** (`lib/gemini.js`): on 404 / 429 / 503 or unparseable output the next
  model in `FALLBACK_MODELS` is tried (`GEMINI_MODEL` or `gemini-3.5-flash` →
  `gemini-3-flash-preview` → `gemini-2.5-flash-lite` → `gemini-2.0-flash-001`).
- Emails (`lib/emails.js`): three occasion themes, inline-styled HTML; hint emails list the
  "✦" hints and the sender's note; confirmation email warns the sender that recipients
  should check their spam folder. Hint and invite emails carry RFC 8058 one-click
  List-Unsubscribe headers. (The "✓ Exact Wishes" block only renders for old stored rows.)
- Fail-safe philosophy: if ANY step fails, nothing is sent.
- Storage: Supabase (pending submissions, pull requests, blocklist), `schema.sql` provided.

## 3. Architecture map

```text
Browser (index.html, vanilla JS)
   │  POST /api/mask ────────────► Gemini (wishes → hints + brand list)
   │  POST /api/give-hint ───────► validate → scrub hints → blocklist → Supabase (pending)
   │                                └─► Resend: confirmation email to SENDER only
   │  GET  /api/confirm?token ───► page with a "Send the hints" button (sends nothing)
   │  POST /api/confirm?token ───► atomic claim pending→sent → Resend: hint emails
   │                                to each recipient (with unsubscribe link + List-Unsubscribe header)
   │  POST /api/get-hint ────────► blocklist → Supabase (hint_requests) → Resend: invite
   │  GET  /api/unsubscribe ─────► verify HMAC → page with an "Unsubscribe" button
   │  POST /api/unsubscribe ─────► verify HMAC → Supabase blocklist (also RFC 8058 one-click)
   │  POST /api/feedback ────────► Resend: email to FEEDBACK_TO (or EMAIL_FROM)
   │  POST /api/track ───────────► Supabase analytics_events (anonymous page views)
   │
   │  Every POST endpoint above (except confirm/unsubscribe) is rate limited per IP
   │  (lib/ratelimit.js → hit_rate_limit() in Supabase). Server-side events are
   │  recorded with lib/analytics.js. Nightly pg_cron job cleanup_old_rows() enforces
   │  the retention promised in privacy.html.
```

Data shapes used across the give flow:

```text
sections (raw, private)   = { hints: "free text, one wish per line" }
hints    (what is sent)   = { hints: ["masked hint", ...], exact: [] }   // exact kept empty for the stored shape
special_notes             = "optional note, sent word-for-word"
```

Limits: max 20 recipients, 3000 chars of wishes, max 8 hints, 160 chars per hint, 600 chars note.

## 4. Environment variables (Vercel → Settings)

| Var | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Google AI Studio key |
| `GEMINI_MODEL` | no | first model to try; default `gemini-3.5-flash`, fallbacks follow automatically |
| `RESEND_API_KEY` | yes | resend.com |
| `EMAIL_FROM` | yes | `Hint & Seek <hints@domain.com>`; domain needs SPF + DKIM in Resend |
| `SITE_URL` | yes | `https://www.hintandseek.com` — used in confirm / unsubscribe / invite links (trailing slash stripped by `siteUrlFrom()`) |
| `SUPABASE_URL` | yes | project REST URL |
| `SUPABASE_SERVICE_KEY` | yes | service role key (server-side only!) |
| `APP_SECRET` | yes | long random string; HMAC for unsubscribe links |
| `FEEDBACK_TO` | no | where feedback-widget emails go; falls back to `EMAIL_FROM` |

## 5. Conventions — keep these

- **Minimal dependencies.** Keep the zero-dependency (fetch + Node 18+) rule as long as
  possible. The user is open to external packages ONLY IF it significantly simplifies the work.
- ES modules (`"type": "module"` in package.json).
- Frontend is ONE file (`index.html`), vanilla JS, no framework, no build step.
- All user-facing copy is English, warm, no pushy tone ("no pressure and no obligation"
  appears in every hint email — keep it).
- Design tokens live in `:root` of `index.html` (paper `#f3ead7`, ink `#3a2c1c`,
  seal red `#a4443a`, desk `#2e2318`; fonts: Caveat for handwriting, EB Garamond for body).
  Background: wood grain only (no desk decorations — removed at the user's request).
- Privacy: never log raw wishes; Gemini receives only the wishes text — no recipient
  emails, names, or the note; recipient emails are used for delivery + blocklist only.
- Masking safety: `checkHints()` in `lib/gemini.js` runs on Gemini output, and again on
  user-edited hints in `give-hint.js` (which refuses to send if a hint leaks). It combines
  a heuristic (`brandLikeTokens`: letter+digit mixes, inner capitals, ALL CAPS, capitalised
  words mid-sentence) with the `brands` list Gemini extracts from the raw text (the browser
  sends it back to give-hint). Whole-word matching only. Never remove this double check.
  The "Anything specific?" note is intentionally NOT checked — it is the user's own words.
- Links in emails must never act on a plain GET (mail scanners open them). GET shows a
  page with a button; the action happens on POST. Keep it that way for any new link.

## 6. How to run / deploy

- **Local:** `npm i -g vercel` → `vercel dev` in the project root (needs a `.env` with the
  vars above; `vercel env pull` after linking the project). Static preview of just the
  UI: open `index.html` in a browser — API calls fall back to "preview mode".
- **Deploy:** push to GitHub → import in Vercel → set env vars → run `schema.sql` in Supabase.
- Full test checklist is in README.md.

## 7. Prioritised TODO list (agreed next steps)

**Phase 1: Backend security & stability** — DONE (Sep 2026)
1. Rate limiting — `lib/ratelimit.js` + `hit_rate_limit()` in `schema.sql` (Supabase instead
   of Upstash, so no extra service). IPs stored only as an HMAC hash. Limits live in `LIMITS`.
   The limiter fails open: it only guards against abuse, it is not a sending gate.
2. Cleanup — `cleanup_old_rows()` + pg_cron job `hint-seek-cleanup` (03:17 UTC): deletes
   expired pending rows, failed rows > 7 days, erases `raw_sections` once sent/failed,
   deletes sent submissions and `hint_requests` > 90 days, analytics > 13 months.
   These periods are promised in `privacy.html` — change both together.

~~**Phase 2: "Keep wish as is"**~~ — dropped. An "Exact Wishes" tab existed (Aug 2026) and
was removed (Sep 2026): masking is the product. Specific wishes go in the optional note.

**Phase 3: Polishing & analytics** — DONE (Sep 2026)
3. Analytics — `lib/analytics.js` + `api/track.js` → `analytics_events`, with summary views
   `analytics_daily`, `analytics_page_views`, `analytics_ai_edits`. No cookies, IPs, emails,
   names or text. Tracking never blocks a flow (errors swallowed, 1.5 s timeout). AI edit
   counts are computed in the browser (`editStats` in the give-hint payload) and sanitized
   server-side (`cleanCounts`).
4. Landing polish — `privacy.html` (footer link), `favicon.svg`, `apple-touch-icon.png`,
   `og-image.png` + OG/Twitter meta with absolute URLs on `https://www.hintandseek.com`.

(Features like "per-recipient sections" and "anonymous reservation" are postponed and
are currently NOT a priority.)

## 8. Working rules for AI assistants

- Read this file and README.md before proposing changes.
- Work ONE phase/TODO at a time. Ask the user which one to tackle first.
- Never weaken the fail-safe pipeline. Required: name, sender email, ≥1 recipient,
  occasion, and at least one wish. The "Anything specific?" note stays optional.
- Never introduce a step where recipients receive anything before the sender's
  email confirmation.
- Keep the zero-dependency + single-file-frontend constraints unless the user
  explicitly agrees to change them.
- When you change behaviour, update README.md and this file in the same commit.
- The user is not a professional developer: explain changes simply, give exact
  copy-paste commands, and prefer small verifiable steps.
