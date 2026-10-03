# HANDOVER — Hint & Seek

> **Purpose of this file:** everything a developer or an AI assistant needs to continue
> this project without any prior conversation context. If you are an AI assistant:
> read this file and README.md fully before changing anything, then follow
> "Working rules" at the bottom.

## 1. What this project is

Hint & Seek is a small web app that solves gift-giving two ways:

- **Give a hint (push):** a person writes what they need, want and like — one wish per line or grouped
  by a tag (`needs: slippers, a comb, hair wax`) — chooses recipients and an occasion (Christmas /
  Birthday / Valentine's Day / Other), checks the tidied list in an instant preview, confirms via an
  email link, and only then do recipients get a themed email with the list (plus a "save to your
  phone" picture page). An optional personal note (`special_notes`) goes at the end.
- **Get a hint (pull):** a gift-giver enters their own name + email and the email of the
  person they're shopping for; that person receives a friendly invite to fill in the
  Give flow. The invite link (`?flow=give&occasion=…&to=<requester>&from=<name>`)
  pre-fills the requester as a recipient, so the list reaches them automatically.

**Product decision (Oct 2026) — no more AI masking.** Until Oct 2026 every wish went through Gemini
and was rewritten into a vague "hint" so givers never saw the exact item. Testing with a real list
showed that people mostly write general wishes anyway (nothing to hide), and those who name a product
("Nike Pegasus, size 42") want exactly that — hiding it is a disservice. So: the list is tidied in the
browser (`parseWishList()` in `index.html`) and sent as written; the value is *easy writing* (tags),
*one-click sharing* and the phone card. AI returns as an on-demand **gift-ideas helper for givers**
(next step): on the save page a giver taps "Gift ideas" for a wish, sets a budget and an optional
note, and gets 3 concrete ideas — the AI is only called when someone asks. Don't bring masking back
without new evidence (`mask_ok` analytics with `specific`/`general` counts exist for older data).

## 2. Current state (October 2026) — DONE

- Vintage "old paper on a wooden desk" single-page frontend (`index.html`):
  - landing choice cards (Give / Get) + on-sheet "how it works" (3 numbered stamps)
    and an example: a tagged line you write → the grouped list they get
  - give form in two groups ("From you, to them" / "What you wish for"): name + sender
    email side by side, recipient chips, occasion, one wishes box with "+" inspiration
    tags, optional personal note
  - instant preview (`parseWishList()`: tags → groups, commas → separate wishes, brackets kept,
    "size 42"/colour parts stay with their wish) with inline editing (add / edit / delete)
  - get form (requester name + email, target email, occasion)
  - success view
  - the wax seal on the sheet corner is the home button (`#home-seal`, switches to the landing view in place)
  - the wishes box colours the line tags (needs:, wants: …) with a mirror layer behind a transparent-text
    textarea (`.wish-mirror`, `syncWishes()`); the box grows with its content
  - floating feedback widget (speech-bubble button → suggestion / bug / other)
  - brand mark = red wax seal with a serif "H": `favicon.svg` (tab icon on every page, incl.
    the confirm / unsubscribe pages rendered by `api/confirm.js` + `api/unsubscribe.js`),
    `apple-touch-icon.png`, and a CSS seal on the corner of the sheet / cards
  - the give form autosaves as a draft in localStorage (`hs-give-draft-v1`: name, sender email,
    recipients, occasion, wishes, note) and is restored on the next visit with a "Welcome back"
    notice + "Start fresh"; the landing card then says "Continue your draft". Deleted after the
    hints are submitted, on "Start fresh", or after 60 days. Mentioned in `privacy.html`.
    A link's `occasion` / invite recipient wins over / is added to the draft.
  - browser back/forward moves between views (`history.pushState` in `show()`), so the phone's
    back button no longer leaves the site mid-form
  - confirm (`api/confirm.js`): if anything fails after the submission was claimed but before
    any email went out, it is released back to `pending` so the link still works; partial
    delivery tells the sender which addresses failed
  - `EMAIL_RE` rejects quotes, brackets, commas etc. (same rule in `index.html` `isEmail`)
  - icons are an inline SVG sprite (`<symbol>`s at the top of `<body>`), no emoji in the UI;
    views fade in on switch, the success postmark "stamps" down (both off with
    `prefers-reduced-motion`); a tiny head script hides the sheet until fonts load (max 1.2 s)
  - meta description, `theme-color`, OG/Twitter tags; share image `og-image.png` (1200×630)
  - works as a static preview without backend ("preview mode")
- Backend (Vercel serverless, zero npm dependencies, plain `fetch` everywhere):
  - `api/give-hint.js` — strict validation, blocklist, stores to `pending`,
    confirmation email to sender
  - `api/confirm.js` — GET shows a button, POST sends the hint emails, marks `sent`
  - `api/get-hint.js` — pull invite (stores requester name + email)
  - `api/unsubscribe.js` — HMAC-signed opt-out (GET shows a button, POST) → blocklist
  - `api/feedback.js` — feedback widget → email to the site owner
- `lib/gemini.js` — small helper (`askGemini(system, user)`): JSON output, `thinkingLevel: "minimal"`,
  automatic model fallback (`GEMINI_MODEL` or `gemini-3.6-flash` → `gemini-3.5-flash` →
  `gemini-3-flash-preview` → `gemini-2.5-flash`). Not used by the give flow any more; kept for the
  gift-ideas feature. Measured Oct 2026: a gift-ideas request ≈ 170 in / 220 out tokens ≈ 0.2 cent, ~2 s.
  The key needs **billing enabled** (free tier ≈ 20 requests per model per day).
- Wish list shape (stored in the historically named `masked_hints` column):
  `{ hints: [flat], groups: [{ label, hints }], exact: [] }` — labels are the English tag names
  ("Needs", "Wants", "Likes", "Craves", "Dreams of", "Is into", "Enjoys", "Hobbies"; translate them when
  the site gets more languages), max 30 wishes / 12 groups (`MAX_HINTS` in lib/validate.js and
  `parseWishList()`); preview, emails and the save page render the groups and fall back to the flat
  list for older rows.
- Emails (`lib/emails.js`): four occasion themes, inline-styled HTML; list emails show the grouped
  "✦" wishes, the sender's note and a "Save this list to your phone" button; confirmation email warns
  the sender that recipients should check their spam folder. List and invite emails carry RFC 8058 one-click
  List-Unsubscribe headers. (The "✓ Exact Wishes" block only renders for old stored rows.)
- Fail-safe philosophy: if ANY step fails, nothing is sent.
- Storage: Supabase (pending submissions, pull requests, blocklist), `schema.sql` provided.

## 3. Architecture map

```text
Browser (index.html, vanilla JS)
   │  (preview: parseWishList() in the browser — no request)
   │  POST /api/give-hint ───────► validate → blocklist → Supabase (pending)
   │                                └─► Resend: confirmation email to SENDER only
   │  GET  /api/confirm?token ───► page with a "Send the list" button (sends nothing)
   │  POST /api/confirm?token ───► atomic claim pending→sent → Resend: wish-list emails
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
sections (raw)            = { hints: "the wishes text as typed" }          // erased after sending
hints    (what is sent)   = { hints: [...], groups: [{ label, hints }], exact: [] }  // the list as approved
special_notes             = "optional personal note"
```

Limits: max 20 recipients, 3000 chars of wishes, max 30 wishes / 12 groups, 160 chars per wish, 600 chars note.

## 4. Environment variables (Vercel → Settings)

| Var | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Google AI Studio key |
| `GEMINI_MODEL` | no | first model to try; default `gemini-3.6-flash`, fallbacks follow automatically |
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
- Privacy: never log wishes; no AI service receives them in the give flow; recipient emails are
  used for delivery + blocklist only. (When gift ideas arrive: send Gemini only the wish list text and
  the giver's budget/note — never names or emails — and update `privacy.html`.)
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
was removed (Sep 2026). In Oct 2026 masking itself was dropped too — see the product decision in §1.

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
  occasion, and at least one wish. The personal note stays optional.
- Never introduce a step where recipients receive anything before the sender's
  email confirmation.
- Keep the zero-dependency + single-file-frontend constraints unless the user
  explicitly agrees to change them.
- When you change behaviour, update README.md and this file in the same commit.
- Hint emails link to `api/hints.js` (signed with `hintsUrl()` in `lib/security.js`, HMAC over the
  submission id): a card drawn on a canvas in the browser and shown as a PNG `<img>` (long-press → save),
  plus "Save as picture" (iOS: share sheet → Save Image; elsewhere a download), "Send to someone"
  (Web Share with the image + text) and "Copy text". The wisher's name is always on the card. Works while
  the submission exists (sent rows are deleted after 90 days).
- Each hint is written in the language of its own wish (Slovenian in → Slovenian out); the email frame stays English.
- Adding an occasion touches: `OCCASIONS` in `lib/validate.js` and `index.html`, both `<select>`s,
  `THEMES` + `occasionText` in `lib/emails.js`, and the two occasion CHECK constraints in `schema.sql`
  (re-run `schema.sql` in Supabase BEFORE deploying, or inserts with the new value fail). README.md is in English.
- The user is not a professional developer: explain changes simply, give exact
  copy-paste commands, and prefer small verifiable steps.

### Working in parallel sessions (the user often runs 2–3 AI sessions at once)

Several sessions have already built the same feature twice on separate branches
(Sep 2026: two different rate limiters and two `schema.sql` versions). To avoid that:

- **Start from the latest `main`.** Before changing anything: `git fetch origin` and base
  your branch on `origin/main`. If your branch is behind `main`, merge `main` in first.
- **Check open pull requests first.** If another open PR already touches the same feature
  or the same files, tell the user and don't build it again.
- **Shared hot-spot files:** `index.html`, `schema.sql`, `lib/emails.js`, `HANDOVER.md`,
  `README.md`. Keep changes to them small, and mention in your reply that you touched them,
  so the user knows the other sessions must update from `main` after merging.
- **One PR at a time into `main`.** After a PR is merged, other sessions must pull `main`
  before continuing. If your PR was merged, restart your branch from `main` for follow-up work.
- **Database changes live ONLY in `schema.sql`** (keep it safe to re-run: `if not exists`,
  `create or replace`, `drop ... if exists` where needed). Never give the user standalone SQL
  snippets in chat — tell them to run the whole `schema.sql` from `main` in the Supabase
  SQL Editor.
- **Tell the user which branch and PR your work is on**, and remind them to merge PRs one
  by one.

## 9. Session log

### Sep 27, 2026 — branch `claude/epic-hopper-5z37sw` (PR #1, merged)

**Done**
- Phase 1: per-IP rate limiting and the nightly cleanup job.
- Phase 3: analytics, `privacy.html`, icons, OG image and meta tags on `www.hintandseek.com`.
- Retention periods added to the cleanup job, matching `privacy.html`.
- Fixed the missing `hint_requests.requester_email` column.
- Merged main after #2 and resolved the conflicts.

**Decisions (and why)**
- Rate limiting and analytics live in Supabase, not Upstash or a third-party tool.
  Supabase is already required, and the zero-dependency / zero-ops rule applies.
- The rate limiter fails open. It only guards against abuse; the real fail-safes
  (storage, blocklist, sender confirmation) are untouched.
- Analytics store only event names and counts: no cookies, IPs, emails or text.
  AI edit counts are computed in the browser and sanitized on the server.
- Raw wishes are erased once sent. Sent submissions and invite requests are deleted
  after 90 days. Nothing needed the data after sending, and the privacy page must be honest.
- The privacy page says the Gemini API is on the paid plan, so the text is not used for
  training. The owner confirmed this.

**Left open**
- `privacy.html` still needs the operator's name and a contact email (GDPR). The owner
  has not provided them yet, so the page points to the 💬 feedback button.
- Owner actions:
  - re-run `schema.sql` in Supabase and check the `hint-seek-cleanup` cron job;
  - check `SITE_URL` and `EMAIL_FROM` in Vercel;
  - run the README checklist on the live site.
- The pg_cron job was not tested outside Supabase (not available locally).
- Lesson: three sessions ran in parallel on the same files (`index.html`, README,
  HANDOVER). That caused conflicts and duplicated work, e.g. the OG domain was done
  twice. Give each session its own area, merge PRs one at a time, and have every
  session pull the latest `main` first.

### Sep 27 2026, session `claude/zen-gauss-3k9o0m` (PRs #2, #3, #5)

**Done (merged in #2 and #3):**
- Docs brought up to date; the HANDOVER formatting was fixed.
- Brand-leak check rewritten (`checkHints` in `lib/gemini.js`):
  - Gemini now also returns a `brands` list, and edited hints are re-checked against it.
  - `give-hint` refuses to send and names the leaking hint instead of dropping it silently.
- Links in emails need a button click (GET shows a page, POST acts):
  - confirm and unsubscribe work this way;
  - confirm is atomic, so a double click can't send twice;
  - RFC 8058 List-Unsubscribe headers are added.
- The XSS on the unsubscribe page is fixed.
- "Exact Wishes" was removed.
- The invite link pre-fills the requester as a recipient (`?to=&from=`).
- Readable errors are shown when a response isn't JSON, and the feedback form has a honeypot.
- `siteUrlFrom()` strips the trailing slash from `SITE_URL`.
- `schema.sql`:
  - safe to re-run over earlier drafts;
  - explicitly grants `hit_rate_limit` to `service_role`;
  - the user ran it successfully in Supabase and the cron job is scheduled.

**Open (PR #5, not merged yet):** only docs — this log and the "parallel sessions" rules in §8.

**Decisions (and why):**
- ~~**Masking only, no "Exact Wishes".**~~ Superseded in Oct 2026: no masking at all, the list is
  sent as written (see §1).
- **Rate limiting and cleanup: `main`'s version from PR #1 was kept.** This session had built
  its own, and it was dropped to avoid two versions. Note that PR #1's limiter fails open.
- **Supabase instead of Upstash for rate limiting.** It needs no new account or service.
- **The user runs SQL by pasting `schema.sql` into the SQL Editor.** The Supabase connector was
  offered but not needed; giving an AI production DB access is not worth it for one-off steps.

**Left unfinished / ideas:**
- Partial send failures in `confirm.js`: recipients whose email failed are not retried.
- The requester email in the Get flow is not verified. The target sees it and can remove it;
  a real fix would be a confirmation email for the requester.
- There are no automated tests; everything was checked by hand with mocked services,
  headless Chromium and local Postgres. A small zero-dependency `node --test` suite would help.
- PR #4 (`happy-turing`, visual polish) is merged. This PR (#5) also carries the `epic-hopper`
  session log, because both logs were appended to the end of this file and would have conflicted.
