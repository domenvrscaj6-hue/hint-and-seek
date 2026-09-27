# Hint & Seek 🎁

Spletna stran za darila brez ugibanja: oseba napiše svoje želje v dva zavihka,
AI zamaskira tiste, ki naj ostanejo presenečenje, oseba vse pregleda in po e-mail potrditvi
jih dobijo izbrani ljudje. Zamaskiranih želja v izvirni obliki nihče nikoli ne vidi.

## Kako deluje (give tok)

1. Uporabnik izpolni obrazec: ime, svoj mail, prejemniki, priložnost in želje v dveh zavihkih:
   - **Hints & Surprises** — konkretne želje (znamke, modeli, velikosti so dobrodošli);
     AI jih prepiše v nežne namige brez znamk.
   - **Exact Wishes** — želje, ki naj prispejo dobesedno (npr. točen naslov knjige);
     te **ne gredo skozi AI**.

   Vsaj en zavihek mora imeti vsebino. Special notes je lahko prazen.
2. `POST /api/mask` → Gemini spremeni Hints zavihek v namige, Exact Wishes se samo razdelijo
   po vrsticah → uporabnik na strani vse **pregleda, uredi ali izbriše**
   (skupaj mora ostati vsaj en namig ali želja).
3. `POST /api/give-hint` → strežnik še enkrat validira in prečisti namige (fail-safe:
   če je v urejen namig ušla znamka/model, ga odstrani), preveri blocklist,
   shrani oddajo kot `pending` in pošlje **potrditveni mail pošiljatelju**.
   Prejemniki v tem koraku ne dobijo ničesar.
4. Pošiljatelj klikne link → `GET /api/confirm?token=...` → namigi se pošljejo prejemnikom
   (vsak mail ima unsubscribe link), oddaja dobi status `sent`. Link deluje enkrat, poteče v 48 h.

**Fail-safe pravilo skozi cel tok:** če katerikoli korak pade (validacija, maskiranje,
shranjevanje, blocklist, mail), se prejemnikom ne pošlje nič.

## Get tok

Obdarovalec vpiše svoje ime in mail, mail osebe in priložnost → `POST /api/get-hint` →
oseba dobi prijazno vabilo z linkom nazaj na "Give a hint" (z že izbrano priložnostjo).

## Povratne informacije

Plavajoči gumb 💬 spodaj desno odpre obrazec (predlog / napaka / drugo) →
`POST /api/feedback` → sporočilo pride po mailu na `FEEDBACK_TO` (ali `EMAIL_FROM`).

## Struktura projekta

```
index.html           → celoten frontend (HTML + CSS + JS v eni datoteki)
api/mask.js          → Hints zavihek → namigi (Gemini), Exact zavihek → nespremenjeno; za predogled
api/give-hint.js     → validacija + shranjevanje pending + potrditveni mail pošiljatelju
api/confirm.js       → potrditveni link → pošiljanje namigov prejemnikom
api/get-hint.js      → pull tok: vabilo osebi, od katere želiš namige
api/unsubscribe.js   → podpisan opt-out link → blocklist
api/feedback.js      → feedback widget → mail lastniku strani
lib/gemini.js        → Gemini klic z avtomatskim preklopom modelov + scrub filter (brez znamk)
lib/emails.js        → 3 tematske predloge (božič/rd/other) + vabilo + potrditveni mail + Resend
lib/store.js         → Supabase (v tej verziji OBVEZEN — brez njega se nič ne pošlje)
lib/security.js      → HMAC podpisi za unsubscribe, generiranje tokenov
lib/validate.js      → stroga validacija (vse obvezno razen Special notes; vsaj en zavihek)
schema.sql           → tabele za Supabase
HANDOVER.md          → dokument za nadaljevanje razvoja (zate in za AI asistente)
```

## Kaj potrebuješ (vse ima brezplačen tier)

| Storitev | Za kaj | Kje |
|---|---|---|
| Vercel | gostovanje strani + backend funkcij | vercel.com |
| Google Gemini API ključ | maskiranje želja v namige | aistudio.google.com |
| Resend | pošiljanje mailov | resend.com |
| Supabase | **obvezno**: pending oddaje, zahteve, blocklist | supabase.com |
| Domena | da maili ne padajo v spam | katerikoli registrar |

## Postavitev — korak za korakom

1. **GitHub:** nov repozitorij, vanj naloži vse datoteke projekta.
2. **Vercel:** Add New → Project → izberi repozitorij → Deploy.
3. **Environment variables** (Vercel → Settings → Environment Variables):
   - `GEMINI_API_KEY` — tvoj Gemini ključ
   - `GEMINI_MODEL` — opcijsko; prvi model, ki se poskusi (privzeto `gemini-3.5-flash`).
     Če vrne 429 ali 404, se samodejno poskusijo `gemini-3-flash-preview`,
     `gemini-2.5-flash-lite` in `gemini-2.0-flash-001`.
   - `RESEND_API_KEY` — iz resend.com
   - `EMAIL_FROM` — npr. `Hint & Seek <hints@tvojadomena.com>`
   - `SITE_URL` — npr. `https://hintandseek.com` (uporablja se v confirm/unsubscribe/vabilo linkih)
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — iz Supabase (Settings → API) — **obvezno**
   - `APP_SECRET` — dolg naključen niz (npr. 40+ znakov), za podpisovanje unsubscribe linkov
   - `FEEDBACK_TO` — opcijsko; kam pridejo sporočila iz feedback widgeta (privzeto `EMAIL_FROM`)
4. **Supabase:** nov projekt → SQL Editor → prilepi `schema.sql` → Run.
   (Če imaš bazo že od prej, ponovno zaženi `schema.sql` — doda manjkajoči stolpec
   `requester_email`, obstoječi podatki ostanejo.)
5. **Resend:** dodaj domeno, nastavi SPF + DKIM (Resend pokaže točna DNS zapisa) —
   brez tega maili pristajajo v spamu.
6. **Test checklist:**
   - [ ] give tok od začetka do konca na svojem mailu (predogled → potrditveni mail → klik → namigi prispejo)
   - [ ] potrditveni link drugič pokaže "Already done"
   - [ ] namigi ne razkrijejo znamk (poskusi "Sony WH-1000XM5" v Hints zavihku)
   - [ ] Exact Wishes prispejo dobesedno
   - [ ] oba zavihka prazna → obrazec ne pusti naprej
   - [ ] unsubscribe link → vnovično pošiljanje na ta mail se zavrne
   - [ ] get tok: vabilo prispe, gumb odpre stran s pravilno priložnostjo
   - [ ] feedback widget: sporočilo prispe na `FEEDBACK_TO`

## Znani TODO-ji

- Rate limiting po IP (npr. Upstash Redis; trenutno ščitita honeypot in double opt-in).
- Čiščenje starih pending vrstic (Supabase scheduled function ali cron).
- Analitika prek Supabase (ogledi, oddaje, koliko ljudi ureja AI namige).
- Privacy policy stran, favicon, OG tagi za deljenje linkov, prava domena.
- Kasneje (ni prioriteta): različne sekcije za različne prejemnike, anonimna rezervacija namiga.

## Stroški

Pri < 3.000 mailih/mesec: 0 € (Resend free 100/dan, Vercel hobby, Supabase free,
Gemini flash ~centi). Edini realni strošek je domena (~10–15 €/leto).
