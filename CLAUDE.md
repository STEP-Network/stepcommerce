# STEP Commerce — repo guide

Kontekstuel commerce-widget-platform. **Kilden til sandhed er skillen i
`.claude/skills/step-commerce/` — læs `references/spec.md` (§1–15) og
`references/product-summary.md` (beslutningslog) før du ændrer noget.**

## V1-grænsen (ufravigelig)

Dette repo bygger **V1 "Exclusive"** (spec §2). Byg IKKE V2/V3-features:
ingen shared widgets, ingen pricing engine, ingen affiliate-integration,
ingen auto-optimisering, ingen AI-styling, ingen publisher-logins.
CPC **tælles og rapporteres** i V1 (rate card til V2), men faktureres ikke.

## Ufravigelige regler

1. Widget-runtime: vanilla TS, Shadow DOM, **0 dependencies**, ≤30 KB gzip,
   fail silent — en widget der fejler må ALDRIG vælte publisher-siden.
2. Al resolving sker server-side i `/api/serve`; klienten indeholder aldrig
   mapping-tabeller.
3. GAM-kreativ får KVs via `%%PATTERN:key%%`-makroer — læs ALDRIG googletag
   fra SafeFrame. Direkte embed læser googletag → dataLayer → `data-kv`.
4. KV-matching understøtter `eq` / `contains` / `dict` (multi-value keys som
   `mv_ingredients` kræver ordbogsmatch).
5. Stale feed-data (>24 t, konfigurerbart) renderes ALDRIG (markedsføringsloven).
   Fallback-kæde: mapped match → default-sæt → render intet.
6. 100 % kontekstuelt: ingen cookies/user-IDs/TCF-gate. `limited_ads`
   respekteres som serve-signal.
7. Produktionsassets kommer fra annoncørens feed/aftale — aldrig scraped.
8. **Ordbogsmatch er ord-ankret**, aldrig fri substring: "and" må ikke matche
   "vand". Termer på ≤3 tegn matcher kun som helt ord. Chips må kun vise termer
   fra det segment der faktisk blev valgt.
9. **En instans må ikke serveres uden mapping-match** medmindre der er et
   eksplicit default-sæt. Widgetten må aldrig hævde et kontekst-match den ikke
   har lavet (matchLine/chips skjules).
10. **ANNONCE-mærkningen er hard-coded** (størrelse/vægt/opacity) — ingen
    annoncør-token må kunne gøre den usynlig (markedsføringsloven).
11. Fail closed: manglende `ADMIN_USER`/`ADMIN_PASSWORD`/`CRON_SECRET` i
    produktion lukker adgangen, den åbner den ikke.

## Struktur

```
packages/widget    ← runtime (loader + renderer + templates A/B) + playground
packages/db        ← schema.sql (V1-subset af spec §3) + migrate-script
apps/admin         ← Next.js 15: admin-UI + /api/serve + /c/{click_id} + cron
```

## Kommandoer

```
npm install                 # workspaces
npm run typecheck           # alle pakker
npm test                    # unit-tests (rules, ordbog, prisparsing, XML)
npm run widget:build        # esbuild-bundle + gzip-størrelsestjek
npm run widget:playground   # åbn packages/widget/playground/index.html via server
npm run admin:dev           # Next.js dev (kræver DATABASE_URL)
npm run admin:build
npm run migrate -w @stepcommerce/db   # baseline + pending migrations
```

**Lokal udvikling uden Neon:** kør en almindelig Postgres og sæt `LOCAL_PG=1`
sammen med `DATABASE_URL=postgresql://...` — så byttes Neons HTTP-driver ud med
en `pg`-shim (kun dev, se `apps/admin/lib/dev-pg-driver.mjs`).

Widget-playground kører uden database (mock-payloads i `playground/mocks/`).
Admin/API kræver Neon Postgres: sæt `DATABASE_URL`, kør
`npm run migrate -w @stepcommerce/db`.

## Status-tjekliste (opdatér hver session)

Byggeorden = spec §15.

- [x] 1. Schema + migrations (V1-subset af §3)
- [x] 2. Feed-fetcher + Google Shopping-parser + product browser
- [x] 3. Product rules engine + preview
- [x] 4. Template/token-system + renderer (widget-playground)
- [x] 5. Instance + mapping + placement resolver + /api/serve
- [x] 6. Embed-loader + GAM-kreativ-wrapper (snippet generator)
- [x] 7. Event-ingestion + klik-redirect + rollups + dashboard
- [x] 8. Feed health + fallback-adfærd
- [~] 9. Deploy (Vercel + Neon), CNAME, pilot-instans
  - **Vercel:** projekt `stepcommerce` (team STEP Network) er oprettet, git-linket
    til repoet, root directory `apps/admin`, basePath `/stepcommerce`, builds
    grønne, deployment protection slået fra.
  - **DB (klar):** Neon-projekt "STEPnetwork one" (patient-mud-05351693),
    database `neondb`, delt med website-appen. Alt STEP Commerce ligger i
    Postgres-schemaet `stepcommerce` (17 tabeller) — `public` er urørt.
    App-rolle `stepcommerce_app` med `search_path = stepcommerce`.
    Host: `ep-blue-boat-agw15yx3.c-2.eu-central-1.aws.neon.tech`.
    Pilot-seed kørt: placement `PLC_mv_recipe`, draft-instans, 5 pairing-regler
    + dict-mappings på `mv_ingredients`, demo-feed (`/api/demo-feed`).
  - **Rewrite:** branch `stepcommerce-rewrite` i `step-network-website` tilføjer
    proxy `/stepcommerce/*` → stepcommerce.vercel.app. Ikke merget endnu.
  - Migrations kørt i produktion (schema_migration v1 + v2). Pilot-instansen står
    på **draft** (demo-feed må ikke ramme en publisher-side).
  - Udestår (kræver dashboard-adgang): env vars i Vercel (`DATABASE_URL`,
    `PUBLIC_ORIGIN`, `ADMIN_USER`, `ADMIN_PASSWORD`, `CRON_SECRET`),
    production branch = `stepcommerce`, merge af rewrite-branchen — og til
    sidst: skift demo-feed ud med annoncørens rigtige feed, tjek i `/preview`,
    og sæt instansen live.

## Operabilitet

- `/preview` — renderer et rigtigt placement med rigtige feed-data gennem den
  rigtige runtime (også draft-instanser). **Brug den før noget sættes live.**
- `/health` — serve-beslutninger pr. placement med årsagskoder (hvorfor
  renderede den ikke?) + feed-uptime og "indhold ændret". Widgetten fejler
  tavst by design, så dette er det eneste sted man kan se det.

Når du ændrer produktet væsentligt: opdatér også beslutningsloggen i
`.claude/skills/step-commerce/references/product-summary.md`.
