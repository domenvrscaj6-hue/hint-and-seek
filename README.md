# Hint & Seek 🎁

Spletna stran za darila brez ugibanja: oseba napiše svoje želje, AI jih zamaskira v namige,
oseba namige pregleda in po e-mail potrditvi jih dobijo izbrani ljudje.
Želja v izvirni obliki nihče nikoli ne vidi — presenečenje ostane.
To je edini način delovanja aplikacije (ni več zavihka *Exact Wishes*).

## Kako deluje (give tok)

1. Uporabnik izpolni obrazec: ime, svoj mail, prejemniki, priložnost in **želje**
   (konkretno — znamke, modeli, velikosti so dobrodošli; AI jih prepiše v nežne namige brez znamk).
   Vse je obvezno razen polja **Anything specific?** (prej *Special notes*): to je osebna opomba
   na koncu maila, ki gre **dobesedno, brez AI** — npr. »Please, no scented candles this year«
   ali konkretna želja, ki ne rabi biti presenečenje.
2. `POST /api/mask` → Gemini spremeni želje v namige → uporabnik jih na strani
   **pregleda, uredi, doda ali izbriše** (ostati mora vsaj en namig).
3. `POST /api/give-hint` → strežnik še enkrat validira in preveri namige (fail-safe:
   če je v urejen namig ušla znamka/model, pošiljanje zavrne in pove, kateri namig popraviti), preveri blocklist,
   shrani oddajo kot `pending` in pošlje **potrditveni mail pošiljatelju**.
   Prejemniki v tem koraku ne dobijo ničesar.
4. Pošiljatelj odpre link → `GET /api/confirm?token=...` pokaže stran z gumbom **Send the hints** →
   šele klik (`POST`) pošlje namige prejemnikom (vsak mail ima unsubscribe link), oddaja dobi status `sent`.
   Link deluje enkrat, poteče v 48 h.
   *Zakaj gumb:* varnostni skenerji v mailih (Outlook, korporativni filtri) sami odprejo vsak link —
   zgolj odprtje linka zato nikoli ničesar ne pošlje. Enako velja za unsubscribe link.

**Fail-safe pravilo skozi cel tok:** če katerikoli korak pade (validacija, maskiranje,
shranjevanje, blocklist, mail), se prejemnikom ne pošlje nič.

## Get tok

Obdarovalec vpiše svoje ime in mail, mail osebe in priložnost → `POST /api/get-hint` →
oseba dobi prijazno vabilo z linkom nazaj na "Give a hint" (z že izbrano priložnostjo).

## Povratne informacije

Plavajoči gumb z oblačkom spodaj desno odpre obrazec (predlog / napaka / drugo) →
`POST /api/feedback` → sporočilo pride po mailu na `FEEDBACK_TO` (ali `EMAIL_FROM`).

## Struktura projekta

```
index.html           → celoten frontend (HTML + CSS + JS v eni datoteki)
og-image.jpg         → slika za deljenje linkov (Open Graph, 1200×630)
api/mask.js          → želje → namigi (Gemini), za predogled
api/give-hint.js     → validacija + shranjevanje pending + potrditveni mail pošiljatelju
api/confirm.js       → potrditveni link → pošiljanje namigov prejemnikom
api/get-hint.js      → pull tok: vabilo osebi, od katere želiš namige
api/unsubscribe.js   → podpisan opt-out link → blocklist
api/feedback.js      → feedback widget → mail lastniku strani
lib/gemini.js        → Gemini klic z avtomatskim preklopom modelov + scrub filter (brez znamk)
lib/emails.js        → 3 tematske predloge (božič/rd/other) + vabilo + potrditveni mail + Resend
lib/store.js         → Supabase (v tej verziji OBVEZEN — brez njega se nič ne pošlje)
lib/security.js      → HMAC podpisi za unsubscribe, generiranje tokenov
lib/validate.js      → stroga validacija (vse obvezno razen opombe "Anything specific?")
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
   - `SITE_URL` — `https://www.hintandseek.com` (uporablja se v confirm/unsubscribe/vabilo linkih)
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
   - [ ] odprtje potrditvenega linka samo pokaže gumb, pošlje šele klik
   - [ ] potrditveni link drugič pokaže "Already done"
   - [ ] namigi ne razkrijejo znamk (poskusi "Sony WH-1000XM5" in "lego set")
   - [ ] če v predogledu v namig ročno vpišeš znamko, pošiljanje zavrne in pove, kaj popraviti
   - [ ] opomba "Anything specific?" prispe dobesedno na konec maila
   - [ ] prazne želje → obrazec ne pusti naprej
   - [ ] unsubscribe link → stran z gumbom → po kliku se vnovično pošiljanje na ta mail zavrne
   - [ ] get tok: vabilo prispe, gumb odpre stran s pravilno priložnostjo
   - [ ] feedback widget: sporočilo prispe na `FEEDBACK_TO`

## Znani TODO-ji

- Rate limiting po IP (npr. Upstash Redis; trenutno ščitita honeypot in double opt-in).
- Čiščenje starih pending vrstic (Supabase scheduled function ali cron).
- Analitika prek Supabase (ogledi, oddaje, koliko ljudi ureja AI namige).
- Privacy policy stran.
- Kasneje (ni prioriteta): različne sekcije za različne prejemnike, anonimna rezervacija namiga.

## Stroški

Pri < 3.000 mailih/mesec: 0 € (Resend free 100/dan, Vercel hobby, Supabase free,
Gemini flash ~centi). Edini realni strošek je domena (~10–15 €/leto).
