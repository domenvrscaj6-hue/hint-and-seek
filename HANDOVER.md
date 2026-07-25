# HANDOVER — Hint & Seek

> **Purpose of this file:** everything a developer or an AI assistant needs to continue
> this project without any prior conversation context. If you are an AI assistant:
> read this file and README.md fully before changing anything, then follow
> "Working rules" at the bottom.

## 1. What this project is

Hint & Seek is a small web app that solves gift-giving two ways:

- **Give a hint (push):** a person writes their real wishes in three sections
  (Needs / Wants / Likes), chooses recipients and an occasion (Christmas / Birthday / Other).
  An LLM (Google Gemini) masks the exact wishes into gentle, brand-free hints.
  The person reviews and edits the hints, confirms via an email link, and only then
  do recipients get a themed email with the hints. Recipients NEVER see the raw wishes.
- **Get a hint (pull):** a gift-giver enters the email of the person they're shopping for;
  that person receives a friendly invite to fill in the Give flow. This flips the social
  dynamic — nobody imposes a wishlist, hints arrive only on request.

The unique product bet: existing wishlist apps show givers the exact items; here givers
see only hints, so choosing the gift stays theirs and the surprise survives.

## 2. Current state (July 2026) — DONE

- Vintage "old paper" single-page frontend (`index.html`): landing choice, give form
  (name, sender email, recipient chips, occasion, Needs/Wants/Likes tabs with per-tab
  state, special notes), hint preview step with inline editing (add/edit/delete),
  get form, success view. Works as a static preview without backend.
- Backend (Vercel serverless, zero npm dependencies by default, plain `fetch` everywhere):
  - `api/mask.js` — wishes → hints (Gemini)
  - `api/give-hint.js` — strict validation, re-scrub, blocklist, stores to `pending`
  - `api/confirm.js` — token → sends emails, marks `sent`
  - `api/get-hint.js` — pull invite
  - `api/unsubscribe.js` — HMAC-signed opt-out
- Emails (`lib/emails.js`): three occasion themes, inline-styled HTML.
- Fail-safe philosophy: if ANY step fails, nothing is sent. Every form field is required except Special notes.
- Storage: Supabase (pending submissions + blocklist live there), `schema.sql` provided.

## 3. Architecture map

```text
Browser (index.html, vanilla JS)
   │  POST /api/mask ──────────► Gemini (mask wishes → hints)
   │  POST /api/give-hint ─────► validate → scrub → blocklist → Supabase (pending)
   │                              └─► Resend: confirmation email to SENDER only
   │  GET  /api/confirm?token ──► Supabase (pending row) → Resend: hint emails
   │                              to each recipient (with unsubscribe link) → status=sent
   │  POST /api/get-hint ───────► blocklist → Supabase (log) → Resend: invite email
   │  GET  /api/unsubscribe ────► verify HMAC → Supabase blocklist
   4. Environment variables (Vercel → Settings)VarRequiredNotesGEMINI_API_KEYyesGoogle AI Studio keyGEMINI_MODELnodefault gemini-2.5-flash — verify current model namesRESEND_API_KEYyesresend.comEMAIL_FROMyesHint & Seek <hints@domain.com>; domain needs SPF+DKIM in ResendSITE_URLyescanonical https URL, used in confirm/unsubscribe/invite linksSUPABASE_URLyesproject REST URLSUPABASE_SERVICE_KEYyesservice role key (server-side only!)APP_SECRETyeslong random string; HMAC for unsubscribe links5. Conventions — keep theseMinimal dependencies. Keep the zero-dependency (fetch + Node 18+) rule as long as possible. The user is open to external packages ONLY IF it significantly simplifies the work.ES modules ("type": "module" in package.json).Frontend is ONE file (index.html), vanilla JS, no framework, no build step.All user-facing copy is English, warm, no pushy tone ("no pressure and no obligation"appears in every hint email — keep it).Design tokens live in :root of index.html (paper #f3ead7, ink #3a2c1c,seal red #a4443a, desk #2e2318; fonts: Caveat for handwriting, EB Garamond for body).Privacy: never log raw wishes; Gemini receives wishes but no recipient emails or names;recipient emails are used for delivery + blocklist only.Masking safety: scrubAgainstRaw() in lib/gemini.js runs on Gemini output AND onuser-edited hints in give-hint.js. Never remove this double check.6. How to run / deployLocal: npm i -g vercel → vercel dev in the project root (needs a .env with thevars above; vercel env pull after linking the project). Static preview of just theUI: open index.html in a browser — API calls fall back to "preview mode".Deploy: push to GitHub → import in Vercel → set env vars → run schema.sql in Supabase.Full test checklist is in README.md.7. Prioritised TODO list (Agreed Next Steps)Phase 1: Backend Security & StabilityRate limiting on /api/mask, /api/give-hint, /api/get-hint (per IP; Upstash Redisfree tier fits the zero-ops style).Cleanup job for expired pending rows (Supabase scheduled function).Phase 2: Core UX Feature - "Keep Wish As Is" (Opt-out of AI masking)3. Add a highly visible UI mechanism in index.html allowing users to declare specific wishes that should NOT be masked by AI (e.g., specific book titles or electronics where surprise doesn't matter).Implementation details: Either use a special character (e.g., prepending a * to the line in the textarea) or refactor the input into a dynamic list with a "lock" button. The Gemini API prompt in api/mask.js MUST be updated to strictly bypass masking for these specific items.Phase 3: Polishing & Analytics4. Free Analytics: Implement basic, privacy-friendly tracking using Supabase directly (track page views, form submissions, and AI edit rates).5. Landing polish: Add a privacy policy one-pager, favicon, OG tags for link sharing, and set up the real domain.(Note: Features like "per-recipient sections" and "anonymous reservation" are postponed and are currently NOT a priority).8. Working rules for AI assistantsRead this file and README.md before proposing changes.Work ONE Phase/TODO at a time. Ask the user which one to tackle first.Never weaken the fail-safe pipeline or the required-fields rule(only Special notes may be empty).Never introduce a step where recipients receive anything before the sender'semail confirmation.Keep the zero-dependency + single-file-frontend constraints unless the userexplicitly agrees to change them.The user is not a professional developer: explain changes simply, give exactcopy-paste commands, and prefer small verifiable steps.