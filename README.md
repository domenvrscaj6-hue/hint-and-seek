# Hint & Seek 🎁

Spletna stran za darila brez ugibanja: oseba napiše svoje želje (needs / wants / likes),
AI jih zamaskira v namige, oseba namige pregleda in po e-mail potrditvi jih dobijo izbrani ljudje.
Točnih želja nihče nikoli ne vidi.

## Kako deluje (give tok)

1. Uporabnik izpolni obrazec — **vse je obvezno** (ime, svoj mail, prejemniki, priložnost,
   needs + wants + likes), edino Special notes je lahko prazen.
2. `POST /api/mask` → Gemini spremeni želje v namige → uporabnik jih na strani **pregleda,
   uredi ali izbriše** (vsaka sekcija mora obdržati vsaj en namig).
3. `POST /api/give-hint` → strežnik še enkrat validira in prečisti namige (fail-safe:
   če je v urejen namig ušla znamka/model, pošiljanje zavrne), preveri blocklist,
   shrani oddajo kot `pending` in pošlje **potrditveni mail pošiljatelju**.
   Prejemniki v tem koraku ne dobijo ničesar.
4. Pošiljatelj klikne link → `GET /api/confirm?token=...` → namigi se pošljejo prejemnikom
   (vsak mail ima unsubscribe link), oddaja dobi status `sent`. Link deluje enkrat, poteče v 48 h.

**Fail-safe pravilo skozi cel tok:** če katerikoli korak pade (validacija, maskiranje,
shranjevanje, blocklist, mail), se prejemnikom ne pošlje nič.

## Get tok

Obdarovalec vpiše ime, mail osebe in priložnost → `POST /api/get-hint` → oseba dobi
prijazno vabilo z linkom nazaj na "Give a hint" (z že izbrano priložnostjo).

## Struktura projekta

```
index.html           → celoten frontend (HTML + CSS + JS v eni datoteki)
api/mask.js          → želje → namigi (Gemini), za predogled
api/give-hint.js     → validacija + shranjevanje pending + potrditveni mail pošiljatelju
api/confirm.js       → potrditveni link → pošiljanje namigov prejemnikom
api/get-hint.js      → pull tok: vabilo osebi, od katere želiš namige
api/unsubscribe.js   → podpisan opt-out link → blocklist
lib/gemini.js        → Gemini klic + scrub filter (namig ne sme razkriti znamke)
lib/emails.js        → 3 tematske predloge (božič/rd/other) + vabilo + potrditveni mail + Resend
lib/store.js         → Supabase (v tej verziji OBVEZEN — brez njega se nič ne pošlje)
lib/security.js      → HMAC podpisi za unsubscribe, generiranje tokenov
lib/validate.js      → stroga validacija (vse obvezno razen Special notes)
schema.sql           → tabele za Supabase
HANDOVER.md          → dokument za nadaljevanje razvoja (zate in za AI asistente)
```

## Kaj potrebuješ (vse ima brezplačen tier)

| Storitev | Za kaj | Kje |
|---|---|---|
| Vercel | gostovanje strani + backend funkcij | vercel.com |
| Google Gemini API ključ | maskiranje želja v namige | aistudio.google.com (že imaš) |
| Resend | pošiljanje mailov | resend.com |
| Supabase | **obvezno**: pending oddaje, blocklist | supabase.com |
| Domena | da maili ne padajo v spam | katerikoli registrar |

## Postavitev — korak za korakom

1. **GitHub:** nov repozitorij, vanj naloži vse datoteke projekta.
2. **Vercel:** Add New → Project → izberi repozitorij → Deploy.
3. **Environment variables** (Vercel → Settings → Environment Variables):
   - `GEMINI_API_KEY` — tvoj Gemini ključ
   - `GEMINI_MODEL` — opcijsko (privzeto `gemini-2.5-flash`; aktualno ime preveri v AI Studio)
   - `RESEND_API_KEY` — iz resend.com
   - `EMAIL_FROM` — npr. `Hint & Seek <hints@tvojadomena.com>`
   - `SITE_URL` — npr. `https://hintandseek.com` (uporablja se v confirm/unsubscribe/vabilo linkih)
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — iz Supabase (Settings → API) — **obvezno**
   - `APP_SECRET` — dolg naključen niz (npr. 40+ znakov), za podpisovanje unsubscribe linkov
4. **Supabase:** nov projekt → SQL Editor → prilepi `schema.sql` → Run.
5. **Resend:** dodaj domeno, nastavi SPF + DKIM (Resend pokaže točna DNS zapisa) —
   brez tega maili pristajajo v spamu.
6. **Test checklist:**
   - [ ] give tok od začetka do konca na svojem mailu (predogled → potrditveni mail → klik → namigi prispejo)
   - [ ] potrditveni link drugič pokaže "Already done"
   - [ ] namigi ne razkrijejo znamk (poskusi "Sony WH-1000XM5")
   - [ ] prazna sekcija → obrazec ne pusti naprej
   - [ ] unsubscribe link → vnovično pošiljanje na ta mail se zavrne
   - [ ] get tok: vabilo prispe, gumb odpre stran s pravilno priložnostjo

## Znani TODO-ji za v2

- Rate limiting po IP (npr. Upstash Redis; trenutno ščitita honeypot in double opt-in).
- Različne sekcije za različne prejemnike (mami vse, sodelavcem samo likes).
- Anonimna rezervacija namiga ("jaz pokrijem to smer") proti podvajanju daril.
- Čiščenje starih pending vrstic (Supabase scheduled function ali cron).

## Stroški

Pri < 3.000 mailih/mesec: 0 € (Resend free 100/dan, Vercel hobby, Supabase free,
Gemini flash ~centi). Edini realni strošek je domena (~10–15 €/leto).
