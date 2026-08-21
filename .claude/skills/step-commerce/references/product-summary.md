# STEP Commerce — produktresumé & beslutningslog

Kondenseret forståelse af produktet. Den fulde spec er `spec.md` i samme mappe — den vinder altid ved konflikt.

## Produktet i én sætning
En platform hvor STEP indlæser annoncørers produktfeeds, bygger frit stylede recommendation-widgets, leverer dem som JavaScript (direkte eller gennem GAM) på netværkets publisher-sites, matcher produkter til sidens indhold via de GAM key-values, der allerede ligger på siderne — og måler alt first-party, så produktet sælges på outcomes.

## Kommerciel model (fastlagt)
**CPC er kerneproduktet. Affiliate er backfill, når ingen direkte annoncør clearer floor. Exclusive takeovers (fast pris, evt. + CPC/CPM) er premium-tier.** Exclusive = én annoncør ejer hele widgetten, ingen konkurrence-logik. Shared = flere annoncører konkurrerer om slots via eCPM-normaliseret ranking (V3; manuelle vægte i V2).

## Kontekst-motoren — to niveauer
- **Niveau A (placement):** key-values vælger *hvilken widget* der serveres. Eks. fyens.dk: `category=gaming, platform=xbox` → Xbox-widget; PlayStation → PlayStation-widget. Én placering, 10–20 widget-instanser bagved.
- **Niveau B (instans):** key-values vælger *hvilke produkter* der vises. Eks. madensverden.dk: `mv_ingredients` → ordbog (skinkeschnitzler ⇒ svinekød) → segment → produktregel.
- Verificerede produktions-KVs på madensverden.dk: `mv_cat`, `mv_ingredients`, `mv_keywords`, `mv_calories`, `mv_recipeYield`, `mv_cookTime`, `mv_totalTime`, `mv_page`, `Domain`, `step_contextual`, `digiseg`, `limited_ads`, slot-level `refresh`.

## Roadmap
- **V1 "Exclusive" (4–6 uger):** én annoncør pr. widget, manuel/regelbaseret produktvalg, template→instans-model, script-tag + GAM-levering, fuld tracking, dashboard. Sælges som fast sponsorat; CPC tælles og rapporteres alligevel (rate card til V2).
- **V2 "Marketplace":** shared widgets, CPC-motor, Adtraction-affiliate som backfill, placement-regler, manuelle A/B-varianter, per-annoncør-rapportering.
- **V3 "Autopilot":** eCPM-normalisering + Thompson sampling, cold start (syntetisk CTR + garanteret eksploration), AI-styling (prompt → design-token-schema, aldrig rå CSS), conversion postbacks, evt. publisher self-serve.

## Godkendte templates (design låst — se assets/)
- **Template A "Native forum post"** (lav-det-selv.dk × Harald Nyborg): widget som forumindlæg — advertiser-logo som avatar, "Sponsoreret"-badge der spejler forumets badges, diskret ANNONCE-mærkning, konversationel copy i forum-tone, bladrende tilbudsavis (auto-flip ~2,6 s + "peelende" hjørne), kontekst-stribe "Relevant for denne tråd", puls-CTA. HN's rigtige farver: navy #10357F, blå #0097D6, gul #FFED00, rød #E40712 KUN til priser.
- **Template B "Native recipe section"** (madensverden.dk): widget som en af sitets egne sektioner (ikon + serif-overskrift + hairline + chevron), match-linje med ingrediens-chips, tre produktkort med match-score-bar (animeres ved viewability), "derfor"-forklaring pr. produkt, "Bedste match"-badge, advertiser-attribution i footer.

## Nøglebeslutninger (fra udviklingsforløbet)
1. Template + instans-model: instans = template + site + mappings + overrides; restyle template → alle instanser opdateres.
2. GAM-levering er first-class: kreativ får KVs via `%%PATTERN:key%%`-makroer — læs ALDRIG googletag fra SafeFrame. Direkte script-tag læser googletag → dataLayer → data-kv.
3. Ingen TCF-gate: targeting er 100 % kontekstuel, ingen cookies/user-IDs; variant-stickiness = ikke-identificerende random seed. `limited_ads` respekteres som serve-signal.
4. KV-matching SKAL understøtte `eq` / `contains` / `dict` — multi-value keys som mv_ingredients kræver ordbogsmatch.
5. Al resolving sker server-side i /api/serve; klienten indeholder aldrig mapping-tabeller.
6. Widget-runtime: vanilla TS, Shadow DOM, 0 dependencies, budget 30 KB gzip (aktuel ~5 KB), fail silent.
7. Feed-hygiejne: stale prisdata (>24 t) må ikke renderes; fejlende feed → fallback/skjul (markedsføringsloven).
8. Fallback-kæde: mapped match → default-sæt → render intet ("bedre ingenting end en vin der clasher").
9. Managed service først; publisher self-serve er en V3-beslutning baseret på faktisk mapping-volumen.
10. Produktionsassets (logoer, billeder) kommer fra annoncørens feed/aftale — aldrig scraped.
11. Pilot: madensverden.dk-typen, vin × opskrifter. Succeskrav: widget-RPM ≥ 2× display-RPM på samme slot inden 8 uger; ellers kill/rework (besluttet på forhånd). Media Summit '27 (28/1) er offentlig deadline/launch-scene.

## Repo-status
**Kanonisk hjem er nu GitHub: `STEP-Network/stepcommerce`** (zip-round-trips er udfaset — tidligere zip-arbejde blev ikke migreret; repoet er genopbygget fra spec i aug 2026). Struktur: `packages/widget` (vanilla TS-runtime m. begge templates, ~7,4 KB gzip, playground m. mocks + screenshots-verificeret), `packages/db` (schema.sql valideret mod Postgres 16 + migrate/seed), `apps/admin` (Next.js 15: admin-UI, `/api/serve` m. fuld resolver (placement-regler, eq/contains/dict-mapping, fallback-kæde, limited_ads, stale-feed-guard), `/api/events`, `/c/{product_id}`-klik-redirect, feed-fetcher (streaming SAX, upsert, health), rules engine (SQL-kompileret, felt-whitelisted), cron fetch+rollup, dashboard), `CLAUDE.md` (status-tjekliste — opdatér hver session). Færdigt: spec §15 trin 1–8, samt trin 9's infrastruktur: Vercel-projekt `stepcommerce` (basePath `/stepcommerce`, grønne builds) og Neon-database provisioneret (projekt "STEPnetwork one", database `neondb`, isoleret Postgres-schema `stepcommerce` m. 14 tabeller + app-rolle `stepcommerce_app`; `public` urørt) med pilot-seed kørt (placement `PLC_mv_recipe`, live instans, 5 pairing-regler + ordbogs-mappings, indbygget demo-feed på `/api/demo-feed` så hele kæden kan demoes uden annoncørfeed). Udestår: env vars i Vercel, merge af rewrite-branchen `stepcommerce-rewrite` i website-repoet (giver stepnetwork.dk/stepcommerce), og udskiftning af demo-feed med annoncørens rigtige feed. Skillen ligger også i repoet under `.claude/skills/step-commerce/` — hold begge kopier synkrone.
