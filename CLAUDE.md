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
npm run widget:build        # esbuild-bundle + gzip-størrelsestjek
npm run widget:playground   # åbn packages/widget/playground/index.html via server
npm run admin:dev           # Next.js dev (kræver DATABASE_URL)
npm run admin:build
```

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
- [ ] 9. Deploy (Vercel + Neon), CNAME, pilot-instans
  - Vercel-projekt `stepcommerce` (team STEP Network) er oprettet og git-linket,
    root directory `apps/admin`, basePath `/stepcommerce`. Public URL:
    stepnetwork.dk/stepcommerce via rewrite i `v0-step-network-website`.
  - DB: Neon-projekt "STEPnetwork one" (patient-mud-05351693), delt database —
    alt ligger i Postgres-schemaet `stepcommerce` (setup-shared-db.sql → migrate).
  - Udestår: env vars i Vercel, DB-setup kørt, rewrite i website-repoet, pilot-feed.

Når du ændrer produktet væsentligt: opdatér også beslutningsloggen i
`.claude/skills/step-commerce/references/product-summary.md`.
