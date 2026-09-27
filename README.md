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
oseba dobi prijazno vabilo z linkom nazaj na "Give a hint". V obrazcu je priložnost že izbrana,
**mail obdarovalca pa že dodan med prejemnike** — ko oseba odda namige, pridejo naravnost k njemu.

## Povratne informacije

Plavajoči gumb z oblačkom spodaj desno odpre obrazec (predlog / napaka / drugo) →
`POST /api/feedback` → sporočilo pride po mailu na `FEEDBACK_TO` (ali `EMAIL_FROM`).

## Struktura projekta

```
index.html           → celoten frontend (HTML + CSS + JS v eni datoteki)
privacy.html         → stran o zasebnosti (roki hrambe se ujemajo s čiščenjem v schema.sql)
favicon.svg, apple-touch-icon.png, og-image.png → ikona strani in slika za predogled povezav
api/mask.js          → želje → namigi (Gemini), za predogled
api/give-hint.js     → validacija + shranjevanje pending + potrditveni mail pošiljatelju
api/confirm.js       → potrditveni link → pošiljanje namigov prejemnikom
api/get-hint.js      → pull tok: vabilo osebi, od katere želiš namige
api/unsubscribe.js   → podpisan opt-out link → blocklist
api/feedback.js      → feedback widget → mail lastniku strani
api/track.js         → anonimni ogledi strani (analitika)
lib/gemini.js        → Gemini klic z avtomatskim preklopom modelov + scrub filter (brez znamk)
lib/emails.js        → 3 tematske predloge (božič/rd/other) + vabilo + potrditveni mail + Resend
lib/store.js         → Supabase (v tej verziji OBVEZEN — brez njega se nič ne pošlje)
lib/security.js      → HMAC podpisi za unsubscribe, generiranje tokenov
lib/validate.js      → stroga validacija (vse obvezno razen opombe "Anything specific?")
lib/ratelimit.js     → omejitev zahtevkov na IP (števec v Supabase, IP samo kot hash)
lib/analytics.js     → anonimna analitika v Supabase (brez piškotkov, IP-jev, mailov, želja)
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
   - `SITE_URL` — `https://www.hintandseek.com` (uporablja se v confirm/unsubscribe/vabilo linkih;
     poševnica na koncu ni pomembna, koda jo odstrani)
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — iz Supabase (Settings → API) — **obvezno**
   - `APP_SECRET` — dolg naključen niz (npr. 40+ znakov), za podpisovanje unsubscribe linkov
   - `FEEDBACK_TO` — opcijsko; kam pridejo sporočila iz feedback widgeta (privzeto `EMAIL_FROM`)
4. **Supabase:** nov projekt → SQL Editor → prilepi `schema.sql` → Run.
   Datoteko lahko zaženeš večkrat (npr. po posodobitvi) — obstoječi podatki ostanejo.
   Ustvari tudi omejevanje zahtevkov (`rate_limits`), analitiko in nočno čiščenje (pg_cron, 03:17 UTC).
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
   - [ ] 11× zaporedoma "Preview" v eni uri → prijazno sporočilo "take a little break"
   - [ ] Supabase → Database → Cron Jobs: vidiš job `hint-seek-cleanup`
   - [ ] Supabase → Table Editor → `analytics_daily`: po obisku strani vidiš `page_view`
   - [ ] noga strani → "Privacy policy" odpre stran o zasebnosti
   - [ ] povezavo do strani pošlješ v WhatsApp/Messenger → prikaže se slika s pečatom
7. **Domena:** `https://www.hintandseek.com` (povezana v Vercelu, preverjena v Resendu).
   - Vercel → Environment Variables: `SITE_URL=https://www.hintandseek.com`,
     `EMAIL_FROM=Hint & Seek <hints@hintandseek.com>` → Redeploy.
   - Če se domena kdaj spremeni, popravi tudi `og:image`, `og:url` in `canonical` v `index.html`.

## Analitika (kje jo pogledaš)

Supabase → **Table Editor** (ali SQL Editor: `select * from ...`):

| Pogled | Kaj pokaže |
|---|---|
| `analytics_daily` | koliko je bilo vsakega dogodka na dan (ogledi, predogledi, oddaje, poslani namigi…) |
| `analytics_page_views` | ogledi po dnevih in pogledih (`landing`, `give`, `preview`, `get`, `success`); `source = invite` pomeni, da je prišel iz vabila |
| `analytics_ai_edits` | po tednih: koliko AI namigov je ostalo, koliko jih je bilo urejenih/izbrisanih, `edit_rate_pct` |

Shranjujejo se samo imena dogodkov in števila — brez piškotkov, IP-jev, mailov, imen in besedil.
Dogodki se samodejno brišejo po 13 mesecih.

## Znani TODO-ji

- Kasneje (ni prioriteta): različne sekcije za različne prejemnike (mami vse, sodelavcem
  samo nekaj), anonimna rezervacija namiga ("jaz pokrijem to smer") proti podvajanju daril.
- Narejeno: rate limiting po IP, nočno čiščenje baze, analitika, stran o zasebnosti,
  favicon, OG tagi, domena.

## Stroški

Pri < 3.000 mailih/mesec: 0 € (Resend free 100/dan, Vercel hobby, Supabase free,
Gemini flash ~centi). Edini realni strošek je domena (~10–15 €/leto).
