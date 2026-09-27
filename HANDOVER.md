# HANDOVER — Hint & Seek

> **Purpose of this file:** everything a developer or an AI assistant needs to continue
> this project without any prior conversation context. If you are an AI assistant:
> read this file and README.md fully before changing anything, then follow
> "Working rules" at the bottom.

## 1. What this project is

Hint & Seek is a small web app that solves gift-giving two ways:

- **Give a hint (push):** a person writes their wishes in two tabs and chooses recipients
  and an occasion (Christmas / Birthday / Other):
  - **Hints & Surprises** — specific wishes (brands, models, sizes welcome). An LLM
    (Google Gemini) masks them into gentle, brand-free hints. Recipients never see the
    raw text.
  - **Exact Wishes** — things the person wants delivered word-for-word (e.g. a specific
    book title). These bypass the AI entirely.

  At least one of the two tabs must have content. The person reviews and edits the
  result, confirms via an email link, and only then do recipients get a themed email.
- **Get a hint (pull):** a gift-giver enters their own name + email and the email of the
  person they're shopping for; that person receives a friendly invite to fill in the
  Give flow. Nobody imposes a wishlist — hints arrive only on request.

The unique product bet: existing wishlist apps show givers the exact items; here givers
see (mostly) hints, so choosing the gift stays theirs and the surprise survives.

## 2. Current state (September 2026) — DONE

- Vintage "old paper on a wooden desk" single-page frontend (`index.html`):
  - landing choice (Give / Get) + 3-step "how it works" strip
  - give form: name, sender email, recipient chips, occasion, **two tabs**
    (Hints & Surprises / Exact Wishes) with per-tab state and counters, special notes
  - preview step with inline editing (add / edit / delete) for both sections
  - get form (requester name + email, target email, occasion)
  - success view
  - floating feedback widget (💬 → suggestion / bug / other)
  - works as a static preview without backend ("preview mode")
- Backend (Vercel serverless, zero npm dependencies, plain `fetch` everywhere):
  - `api/mask.js` — Hints tab → Gemini; Exact tab → split by lines, passed through
  - `api/give-hint.js` — strict validation, re-scrub, blocklist, stores to `pending`,
    confirmation email to sender
  - `api/confirm.js` — token → sends hint emails, marks `sent`
  - `api/get-hint.js` — pull invite (stores requester name + email)
  - `api/unsubscribe.js` — HMAC-signed opt-out → blocklist
  - `api/feedback.js` — feedback widget → email to the site owner
- Gemini with **automatic model fallback** (`lib/gemini.js`): on 429 / 404 the next
  model in `FALLBACK_MODELS` is tried (`GEMINI_MODEL` or `gemini-3.5-flash` →
  `gemini-3-flash-preview` → `gemini-2.5-flash-lite` → `gemini-2.0-flash-001`).
- Emails (`lib/emails.js`): three occasion themes, inline-styled HTML; hint emails show
  both sections ("✦ hints" and "✓ exact wishes"); confirmation email warns the sender
  that recipients should check their spam folder.
- Fail-safe philosophy: if ANY step fails, nothing is sent.
- Storage: Supabase (pending submissions, pull requests, blocklist), `schema.sql` provided.

## 3. Architecture map

```text
Browser (index.html, vanilla JS)
   │  POST /api/mask ────────────► hints tab → Gemini (mask → hints); exact tab → pass-through
   │  POST /api/give-hint ───────► validate → scrub hints → blocklist → Supabase (pending)
   │                                └─► Resend: confirmation email to SENDER only
   │  GET  /api/confirm?token ───► page with a "Send the hints" button (sends nothing)
   │  POST /api/confirm?token ───► atomic claim pending→sent → Resend: hint emails
   │                                to each recipient (with unsubscribe link + List-Unsubscribe header)
   │  POST /api/get-hint ────────► blocklist → Supabase (hint_requests) → Resend: invite
   │  GET  /api/unsubscribe ─────► verify HMAC → page with an "Unsubscribe" button
   │  POST /api/unsubscribe ─────► verify HMAC → Supabase blocklist (also RFC 8058 one-click)
   │  POST /api/feedback ────────► Resend: email to FEEDBACK_TO (or EMAIL_FROM)
```

Data shapes used across the give flow:

```text
sections (raw, private)   = { hints: "free text, one wish per line", exact: "free text" }
hints    (what is sent)   = { hints: ["masked hint", ...], exact: ["exact wish", ...] }
```

Limits: max 20 recipients, 3000 chars per tab, max 8 AI hints, max 10 exact wishes, 160 chars per item, 600 chars special notes.

## 4. Environment variables (Vercel → Settings)

| Var | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Google AI Studio key |
| `GEMINI_MODEL` | no | first model to try; default `gemini-3.5-flash`, fallbacks follow automatically |
| `RESEND_API_KEY` | yes | resend.com |
| `EMAIL_FROM` | yes | `Hint & Seek <hints@domain.com>`; domain needs SPF + DKIM in Resend |
| `SITE_URL` | yes | canonical https URL, used in confirm / unsubscribe / invite links |
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
- Privacy: never log raw wishes; Gemini receives only the Hints tab text — no recipient
  emails, names, or Exact Wishes; recipient emails are used for delivery + blocklist only.
- Masking safety: `checkHints()` in `lib/gemini.js` runs on Gemini output, and again on
  user-edited hints in `give-hint.js` (which refuses to send if a hint leaks). It combines
  a heuristic (`brandLikeTokens`: letter+digit mixes, inner capitals, ALL CAPS, capitalised
  words mid-sentence) with the `brands` list Gemini extracts from the raw text (the browser
  sends it back to give-hint). Whole-word matching only. Never remove this double check.
  Exact Wishes are intentionally NOT checked.
- Links in emails must never act on a plain GET (mail scanners open them). GET shows a
  page with a button; the action happens on POST. Keep it that way for any new link.

## 6. How to run / deploy

- **Local:** `npm i -g vercel` → `vercel dev` in the project root (needs a `.env` with the
  vars above; `vercel env pull` after linking the project). Static preview of just the
  UI: open `index.html` in a browser — API calls fall back to "preview mode".
- **Deploy:** push to GitHub → import in Vercel → set env vars → run `schema.sql` in Supabase.
- Full test checklist is in README.md.

## 7. Prioritised TODO list (agreed next steps)

**Phase 1: Backend security & stability**
1. Rate limiting on `/api/mask`, `/api/give-hint`, `/api/get-hint`, `/api/feedback`
   (per IP; Upstash Redis free tier fits the zero-ops style). Currently only the
   honeypot field and the double opt-in protect the endpoints.
2. Cleanup job for expired `pending` rows (Supabase scheduled function).

~~**Phase 2: "Keep wish as is"**~~ — DONE via the **Exact Wishes** tab (August 2026).

**Phase 3: Polishing & analytics**
3. Free analytics using Supabase directly (page views, form submissions, AI edit rates).
4. Landing polish: privacy policy one-pager, favicon, OG tags for link sharing, real domain.

(Features like "per-recipient sections" and "anonymous reservation" are postponed and
are currently NOT a priority.)

## 8. Working rules for AI assistants

- Read this file and README.md before proposing changes.
- Work ONE phase/TODO at a time. Ask the user which one to tackle first.
- Never weaken the fail-safe pipeline. Required: name, sender email, ≥1 recipient,
  occasion, and at least one wish across the two tabs. Special notes stays optional.
- Never introduce a step where recipients receive anything before the sender's
  email confirmation.
- Keep the zero-dependency + single-file-frontend constraints unless the user
  explicitly agrees to change them.
- When you change behaviour, update README.md and this file in the same commit.
- The user is not a professional developer: explain changes simply, give exact
  copy-paste commands, and prefer small verifiable steps.
