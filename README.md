# Hint & Seek 🎁

A website for gifts without the guesswork: a person writes down what they need, want and like,
the site tidies it into a neat grouped list, and after an email confirmation the chosen people
receive it — by email and as a picture they can save on their phone.

> **Oct 2026 change:** wishes are no longer rewritten by AI ("masked" into hints). Real lists turned
> out to be mostly general already, and people who name a product usually want exactly that product.
> The list is now tidied in the browser and sent as written. AI is used only for on-demand
> **gift ideas** for the people buying the gift (step 5).

## How it works (give flow)

1. The user fills in the form: name, their email, recipients, occasion and **wishes** — one per
   line, or grouped by a tag: `needs: slippers, a comb, hair wax`. Clicking a tag (needs, wants,
   likes, …) starts a line with it; tags are coloured in the box. The optional **personal note**
   (`special_notes`) goes at the end of the email.
   The form is saved as a **draft in the browser** (localStorage) while they type, so they can come
   back on another day and finish it. The draft is deleted once the list is submitted, when they
   press *Start fresh*, or after 60 days.
2. **Preview** — instant, in the browser (`parseWishList()` in `index.html`, no server call):
   each tag becomes a group (Needs, Wants, Likes …, always in English for now), every comma-separated
   wish becomes its own line (commas in brackets don't split; a size/colour part like "size 42" stays
   with its wish). The user can **edit, add or delete** anything (at least one wish must remain).
3. `POST /api/give-hint` → the server validates the list, checks the blocklist, stores the
   submission as `pending` and sends a **confirmation email to the sender**. Recipients get nothing
   at this step.
4. The sender opens the link → `GET /api/confirm?token=...` shows a page with a **Send the list**
   button → only the click (`POST`) sends the list to the recipients (every email has an
   unsubscribe link and two buttons: "Save this list" and "Get gift ideas"), and the submission becomes `sent`.
   The link works once and expires after 48 h.
   *Why a button:* security scanners in mail clients (Outlook, corporate filters) open every link
   by themselves, so merely opening a link never sends anything. The same applies to the
   unsubscribe link.

5. **Gift ideas (for givers):** the list email links to the save page (`api/hints.js`), which has a
   "Not sure what to pick?" section: pick a budget (10–200 €), optionally say what to keep in mind
   ("for two players"), tap a wish → `POST /api/ideas` → 3 concrete ideas with a typical price, a short
   reason and a "Search ↗" link. Gemini is called only on that tap; repeated questions come from a cache.
   Guards: signed link, the wish must be on the list, 10 requests/hour per IP, 30 AI answers per list.

**Fail-safe rule for the whole flow:** if any step fails (validation, storage, blocklist, email),
nothing is sent to the recipients.

## Get flow

The gift-giver enters their name and email, the other person's email and the occasion →
`POST /api/get-hint` → that person gets a friendly invite with a link back to "Give a hint".
In the form the occasion is already selected and **the gift-giver's email is already added as a
recipient**, so when the person submits their hints, they go straight to the gift-giver.

## Feedback

The floating speech-bubble button in the bottom-right corner opens a form (suggestion / bug / other) →
`POST /api/feedback` → the message is emailed to `FEEDBACK_TO` (or `EMAIL_FROM`).

## Project structure

```
index.html           → the whole frontend (HTML + CSS + JS in one file)
privacy.html         → privacy page (retention periods match the cleanup in schema.sql)
favicon.svg, apple-touch-icon.png, og-image.png → site icon (wax seal) and link-preview image
api/give-hint.js     → validation + storing as pending + confirmation email to the sender
api/confirm.js       → confirmation link → sends the hints to the recipients
api/get-hint.js      → pull flow: invite to the person you'd like hints from
api/hints.js         → "save these hints" page from the hint email: card as a picture, send, copy
api/unsubscribe.js   → signed opt-out link → blocklist
api/feedback.js      → feedback widget → email to the site owner
api/track.js         → anonymous page views (analytics)
api/contact.js       → vCard for "Add Hint & Seek to your contacts" (linked from every email)
api/ideas.js         → gift ideas for one wish (guards, cache, per-list cap)
lib/ideas.js         → the gift-ideas prompt + output cleanup
lib/gemini.js        → small Gemini helper (JSON, minimal thinking, model fallback)
lib/emails.js        → 4 themed templates (Christmas / birthday / Valentine's Day / other) + invite + confirmation email + Resend
lib/store.js         → Supabase (REQUIRED in this version: without it nothing is sent)
lib/security.js      → HMAC signatures for unsubscribe, token generation
lib/validate.js      → strict validation (everything required except the "Anything specific?" note)
lib/ratelimit.js     → per-IP rate limiting (counter in Supabase, IP stored only as a hash)
lib/analytics.js     → anonymous analytics in Supabase (no cookies, IPs, emails or wishes)
schema.sql           → Supabase tables
HANDOVER.md          → handover document for further development (for you and for AI assistants)
```

## What you need (everything has a free tier)

| Service | What for | Where |
|---|---|---|
| Vercel | hosting the site + backend functions | vercel.com |
| Google Gemini API key | gift ideas for givers (billing enabled) | aistudio.google.com |
| Resend | sending emails | resend.com |
| Supabase | **required**: pending submissions, requests, blocklist | supabase.com |
| Domain | so emails don't land in spam | any registrar |

## Setup, step by step

1. **GitHub:** create a new repository and upload all the project files.
2. **Vercel:** Add New → Project → pick the repository → Deploy.
3. **Environment variables** (Vercel → Settings → Environment Variables):
   - `GEMINI_API_KEY`: your Gemini key with billing enabled — used only for gift ideas
   - `GEMINI_MODEL`: optional; the first model to try (default `gemini-3.6-flash`).
     If it returns 429, 404 or 503, `gemini-3.5-flash`, `gemini-3-flash-preview` and
     `gemini-2.5-flash` are tried automatically.
     **Use a key with billing enabled** (Google AI Studio → Billing). A free-tier key allows only
     ~20 requests per model per day, makes the site slow once that runs out, and Google may use
     free-tier data to improve its models (the privacy page promises the paid API).
   - `RESEND_API_KEY`: from resend.com
   - `EMAIL_FROM`: e.g. `Hint & Seek <hints@yourdomain.com>`
   - `SITE_URL`: `https://www.hintandseek.com` (used in the confirm / unsubscribe / invite links;
     a trailing slash doesn't matter, the code removes it)
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`: from Supabase (Settings → API), **required**
   - `APP_SECRET`: a long random string (e.g. 40+ characters), used to sign unsubscribe links
   - `FEEDBACK_TO`: optional; where feedback-widget messages go (defaults to `EMAIL_FROM`)
4. **Supabase:** new project → SQL Editor → paste `schema.sql` → Run.
   You can run the file again at any time (e.g. after an update); existing data is kept.
   It also creates rate limiting (`rate_limits`), analytics and the nightly cleanup (pg_cron, 03:17 UTC).
5. **Resend:** add your domain and set up SPF + DKIM (Resend shows the exact DNS records);
   without them emails end up in spam.
6. **Test checklist:**
   - [ ] give flow end to end with your own email (preview → confirmation email → click → the list arrives)
   - [ ] opening the confirmation link only shows the button; only the click sends
   - [ ] opening the confirmation link a second time shows "Already done"
   - [ ] "needs: slippers, a comb, hair wax" → three separate wishes under "Needs" (preview, email and saved picture)
   - [ ] "Nike Pegasus 41, size 42" stays one wish; "(one big meal)" in brackets is not split
   - [ ] the personal note arrives at the end of the email
   - [ ] empty wishes → the form doesn't let you continue
   - [ ] half-filled form → close the tab → open the site again → "Continue your draft" brings everything back
   - [ ] unsubscribe link → page with a button → after the click, sending to that email again is refused
   - [ ] "Add Hint & Seek to your contacts" in an email downloads a contact card with the EMAIL_FROM address
   - [ ] list email → "Save this list" → the card shows the wisher's name; save / send / copy work on a phone
   - [ ] the tags (needs:, wants: …) are coloured in the wishes box; the wax seal takes you back to the start
   - [ ] save page → "Not sure what to pick?" → pick a budget, tap a wish → 3 ideas with prices and "Search ↗";
         asking the same again answers instantly (cache)
   - [ ] get flow: the invite arrives and its button opens the page with the right occasion
   - [ ] feedback widget: the message arrives at `FEEDBACK_TO`
   - [ ] "Send the list" 6 times in a row within an hour → a friendly "take a little break" message
   - [ ] Supabase → Database → Cron Jobs: you can see the `hint-seek-cleanup` job
   - [ ] Supabase → Table Editor → `analytics_daily`: after visiting the site you see a `page_view`
   - [ ] page footer → "Privacy policy" opens the privacy page
   - [ ] send a link to the site in WhatsApp/Messenger → the preview image with the seal appears
7. **Domain:** `https://www.hintandseek.com` (connected in Vercel, verified in Resend).
   - Vercel → Environment Variables: `SITE_URL=https://www.hintandseek.com`,
     `EMAIL_FROM=Hint & Seek <hints@hintandseek.com>` → Redeploy.
   - If the domain ever changes, also update `og:image`, `og:url` and `canonical` in `index.html`.

## Analytics (where to look)

Supabase → **Table Editor** (or SQL Editor: `select * from ...`):

| View | What it shows |
|---|---|
| `analytics_daily` | how many of each event there were per day (views, previews, submissions, hints sent…) |
| `analytics_page_views` | views per day and per view (`landing`, `give`, `preview`, `get`, `success`); `source = invite` means the visitor came from an invite |
| `analytics_ai_edits` | per week: how many AI hints were kept, how many were edited/deleted, `edit_rate_pct` |

Only event names and counts are stored: no cookies, IPs, emails, names or text.
Events are deleted automatically after 13 months.

## Known TODOs

- Later (not a priority): different sections for different recipients (everything for mum, only
  a few things for colleagues), anonymous reservation of a hint ("I'll cover this one") to avoid
  duplicate gifts.
- Done: per-IP rate limiting, nightly database cleanup, analytics, privacy page, favicon,
  OG tags, domain, saved drafts.

## Costs

Under 3,000 emails/month: €0 (Resend free 100/day, Vercel Hobby, Supabase free,
no AI calls for sending lists). Gift ideas cost ~0.2 cent per AI answer (Gemini 3.6 Flash, minimal
thinking; cached answers are free) — roughly €0.60 a month for 100 givers. The only other real cost
is the domain (~€10–15/year).
