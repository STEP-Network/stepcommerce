# STEP Commerce

STEP Networks kontekstuelle commerce-widget-platform: produktfeeds ind, frit
stylede widgets ud via JavaScript/GAM, matchet til sidens indhold via
key-values, målt first-party og solgt på CPC/affiliate/exclusive.

**Dokumentation:** den fulde spec, produktresumé (beslutningslog) og
salgsnarrativ ligger i `.claude/skills/step-commerce/references/`.
Arbejdsregler for AI-sessioner: `CLAUDE.md`.

## Status: V1 "Exclusive"

Spec §15 trin 1–8 er bygget; trin 9 (deploy + pilot) udestår.

| Del | Hvad |
|---|---|
| `packages/widget` | Widget-runtime: vanilla TS, Shadow DOM, 0 deps, ~7,4 KB gzip. Templates: **Native forum post** (bladrende tilbudsavis) og **Native recipe section** (match-score bars) + generiske card-layouts. Playground med mocks. |
| `packages/db` | Postgres-schema (V1-subset af spec §3), migrate- og seed-scripts. |
| `apps/admin` | Next.js 15: internt admin-UI, `POST /api/serve` (server-side resolver), `POST /api/events`, `GET /c/{product_id}` (klik-redirect), feed-fetcher-cron (streaming Google Shopping XML), rollup-cron, dashboard. Servér også `w.js`. |

## Kom i gang

```bash
npm install
npm run widget:build        # bygger dist/w.js og håndhæver 30 KB-budgettet
npm run widget:playground   # http://localhost:4173 — begge templates med mocks, uden DB

# Med database (Neon):
export DATABASE_URL=postgres://...
npm run migrate -w @stepcommerce/db
npm run seed -w @stepcommerce/db    # pilot-skelet: madensverden.dk × vin
npm run admin:dev
```

## Deployment

Appen kører med `basePath: '/stepcommerce'` og eksponeres på
**stepnetwork.dk/stepcommerce** via en rewrite i website-projektet
(`v0-step-network-website`), som proxy'er `/stepcommerce/:path*` til dette
projekts deployment. Vercel-projekt: `stepcommerce` (root directory
`apps/admin`, monorepo-install fra repo-roden).

Databasen deles med STEP Networks øvrige apps (Neon-projekt "STEPnetwork one");
alle tabeller ligger i det dedikerede Postgres-schema **`stepcommerce`** —
kør `packages/db/setup-shared-db.sql` som DB-owner én gang (opretter schema +
app-rollen `stepcommerce_app` med `search_path = stepcommerce`), og derefter
`npm run migrate -w @stepcommerce/db` med app-rollens connection string.

## Miljøvariabler (apps/admin)

| Var | Bruges til |
|---|---|
| `DATABASE_URL` | Neon Postgres — forbind som `stepcommerce_app` (shared DB) |
| `PUBLIC_ORIGIN` | Absolut base inkl. base path for klik-URLs og beacons: `https://stepnetwork.dk/stepcommerce` |
| `WIDGET_ORIGIN` | Base i genererede embed/GAM-snippets (default = PUBLIC_ORIGIN) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Basic auth på admin-UI (V1; udelades i lokal dev) |
| `CRON_SECRET` | Bearer-token på cron-endpoints |
| `PREVIEW_KEY` | Tillader serve af draft-instanser med `?preview_key=` |
