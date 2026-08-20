# STEP Commerce — Product & Build Specification

**Owner:** Ulrik Kristensen, VP Product & Publishers, STEP Network
**Version:** 1.0 — August 2026
**Purpose:** Complete, build-ready specification for a contextual commerce widget platform. Written to be handed to an AI coding agent (or dev team) as the single source of truth. Covers the full "dream product" plus a three-phase roadmap: V1 ships the exclusive widget product fast, V2 adds the shared CPC/affiliate marketplace, V3 adds self-optimisation and AI styling.

---

## 1. Product summary

STEP Commerce is a platform where STEP Network:

1. **Ingests advertiser product feeds** (Google Shopping XML as canonical format; other XML/CSV via mapping).
2. **Builds recommendation widgets** with fully flexible styling and sizing — from a 930×180 desktop leaderboard to a 300×320 mobile card, or fully container-responsive.
3. **Delivers widgets via JavaScript** — either a direct on-page script tag or served through Google Ad Manager (GAM/DFP) as an HTML5 custom creative.
4. **Targets contextually using GAM key-values already present on publisher pages** — at two levels: which *widget* to show (placement rules), and which *products* to show inside a widget (product mapping). Example: `category=xbox` triggers the Xbox widget; `recipe_type=pork` makes the wine widget show pork-pairing wines.
5. **Tracks everything first-party**: widget loads, viewable impressions, product impressions, clicks, and (via affiliate SubIDs / merchant postbacks) conversions.
6. **Monetises on a commercial ladder**: **CPC is the primary product**, **affiliate is the backfill** when no CPC demand clears, and **exclusive takeovers** (fixed fee, optionally + CPC/CPM) are the premium tier.

### Commercial model (canonical)

| Tier | What it is | Pricing | Ranking logic |
|---|---|---|---|
| **Exclusive widget** | One brand owns the entire unit: branded styling, only their feed | Fixed monthly/period fee, optionally + CPC or CPM | None — no competition |
| **Shared widget** | Multiple advertisers' products compete for slots | CPC (primary) or CPM per widget load | eCPM-normalised ranking (V3), manual weights (V2) |
| **Affiliate backfill** | Fills slots when no direct advertiser clears the floor | Rev-share of network commission | Ranked by EPC once data exists |

Every widget carries a **revenue configuration** set at creation: which advertisers participate, each advertiser's pricing model (CPC rate / CPM rate / affiliate), floors, and whether affiliate backfill is enabled.

---

## 2. Roadmap: three versions

### V1 — "Exclusive" (target: pilot-ready in 4–6 weeks)

Ship the sellable premium product with the least machinery.

**In scope:**
- Advertiser CRUD (internal admin only).
- Feed ingestion: Google Shopping XML, scheduled refetch, feed health monitoring.
- One advertiser per widget (exclusive mode only).
- Product selection: pick specific products manually, OR rule-based filters on feed fields (e.g. `custom_label_0 = weekly_offer`, `availability = in stock`, price ranges, category contains).
- Widget templates with design-token styling (manual token editing, live preview). Fixed-size variants per instance (e.g. desktop 930×180, mobile 300×320) plus a fluid/responsive mode.
- Template → instance model: instance = template + site + key-value product mapping + size/style overrides. Duplicate-and-remap in one click.
- Key-value **product** mapping (page KV → product segment) with paste-in bulk import.
- Delivery: direct script tag AND GAM HTML5 creative.
- Tracking: widget load, viewable impression (IntersectionObserver, 50% / 1s), product impression, click (server-side redirect). Dashboard: per widget/instance/site/day.
- Fallback chain: mapped match → default product set → don't render (collapse gracefully).

**Explicitly out of scope in V1:** multiple advertisers per widget, pricing engine, affiliate, auto-optimisation, AI styling, publisher logins.

**V1 revenue:** sold manually as fixed-fee exclusive sponsorships (e.g. wine merchant owns the wine widget on recipe sites). CPC counted and reported even if billed as fixed fee — this builds the rate card for V2.

### V2 — "Marketplace" (weeks 6–14)

**Adds:**
- Shared widgets: N advertisers per widget, per-advertiser pricing model (CPC / CPM / affiliate).
- Manual rotation weights per advertiser (e.g. A 60% / B 40%) + per-slot floors.
- Affiliate integration (start: **Adtraction**; architecture supports Partner-ads and others): programme catalogue, deeplink building, SubID decoration (`subid={click_id}`), commission import via API/report ingest for EPC calculation.
- Placement layer: **key-value → widget selection rules**. A placement holds an ordered rule list ("if `category=xbox` → Xbox widget; if `category=playstation` → PlayStation widget; else → default widget / render nothing").
- Manual split testing: multiple variants per instance (styling AND/OR product logic AND/OR revenue config), fixed traffic split, sticky visitor assignment, per-variant reporting with statistical significance indicator.
- Per-advertiser reporting + exportable invoicing data (clicks × CPC, loads × CPM, affiliate commission).
- Basic click-quality filtering (bot UA lists, click-spam rate limits, double-click dedupe).

### V3 — "Autopilot" (2027)

**Adds:**
- **eCPM normalisation engine**: every monetisable object (product slot, advertiser, variant) is scored in a common currency — effective CPM = expected revenue per 1,000 widget loads. CPC items: `CPC × CTR × 1000`. CPM items: face value. Affiliate: `EPC × CTR × 1000`.
- **Auto-optimisation** of variant traffic and slot allocation using a multi-armed bandit (Thompson sampling — matches STEP's existing optimisation pattern in the idea-to-product pipeline). Always overridable: manual weights pin any advertiser/variant.
- **Cold start**: new products/advertisers/variants receive a synthetic prior CTR (configurable, e.g. category-average) and a guaranteed exploration share (e.g. minimum 10% of loads) until N impressions collected; then the prior decays into observed data.
- **AI styling**: prompt-driven widget design. Input = brand brief, publisher URL or screenshot; output = a filled design-token schema (never raw free-form CSS), previewed and hand-tunable. Optionally packaged as an internal Claude skill, consistent with STEP's skill-library practice.
- Conversion postbacks for direct CPA deals (S2S pixel with click_id echo).
- Publisher self-serve portal (only if mapping volume demands it — decide from V2 ops load).
- Alerting: feed failures, CTR collapse, revenue drift (same discipline as the AY weekly drift reports).

---

## 3. Domain model

Entities and key fields. (Postgres; all tables get `id`, `created_at`, `updated_at`.)

**advertiser** — name, company info, billing contact, status. One advertiser has **many feeds** and many pricing agreements.

**feed** — advertiser_id, name, source_url, type (`google_shopping_xml` | `generic_xml` | `csv`), field_mapping (JSONB, for non-Google formats), fetch_schedule (cron), last_fetch_at, status (`healthy` | `stale` | `failing`), error_log.

**product** — feed_id, external_id, title, description, link, image_link, additional_images, price, sale_price, availability, brand, gtin, product_type, google_product_category, custom_label_0–4, raw (JSONB for any extra fields). Upserted on each fetch; soft-delete products missing from latest fetch.

**product_rule** — reusable filter definition: feed_id, name, conditions (JSONB array of `{field, operator, value}` with AND/OR groups; operators: equals, contains, in, gt/lt, exists). Example: `custom_label_0 = "ugens_tilbud" AND availability = "in stock"`. A widget's product source is either an explicit product list, a product_rule, or "entire feed".

**widget_template** — name, layout_type (`carousel` | `grid` | `stacked` | `single_card` | custom), design_tokens (JSONB, see §6), slot_count config, default behaviours.

**widget_instance** — template_id, site_id, name, mode (`exclusive` | `shared`), size_config (JSONB: named size variants w/ breakpoints, or `fluid`), token_overrides (JSONB), kv_product_mappings (see mapping table), fallback_config (`default_products` | `hide`), status.

**instance_advertiser** — instance_id, advertiser_id, product_source (product_rule_id | explicit list | full feed), pricing_model (`cpc` | `cpm` | `affiliate` | `fixed`), rate, floor, manual_weight (nullable), priority.

**variant** — instance_id, name, traffic_share, overrides (JSONB: tokens and/or product logic and/or revenue config deltas), status. Sticky assignment key: hash(visitor_seed + instance_id).

**site** — publisher, domain, known key-value taxonomy (imported/documented), contact.

**placement** — site_id, name, code (the ID referenced by the embed tag / GAM creative), rules (ordered JSONB list: `{match: {key, operator, value}, widget_instance_id}`), default_instance_id (nullable → render nothing).

**kv_mapping** — instance_id, page_key, page_value, target (product segment: rule_id, tag, category filter, or explicit products). Bulk import: paste two-column list.

**event** — append-only: type (`load` | `viewable` | `product_impression` | `click`), placement_id, instance_id, variant_id, advertiser_id, product_id, site_id, kv_context (JSONB), device_class, ts, click_id (for clicks), quality_flags. Aggregated hourly into **stats_hourly** (all the same dimensions + counts) for dashboard speed; raw events retained ≥ 13 months.

**conversion** — click_id, source (`affiliate_import` | `postback`), order_value, commission, ts.

**affiliate_programme** — network (`adtraction` | ...), programme_id, advertiser_id link, deeplink template, epc_estimate (updated from imports).

---

## 4. Feed ingestion

1. **Canonical schema = Google Shopping XML** (RSS 2.0 / Atom, `g:` namespace). Everything else maps into it.
2. **Fetcher**: scheduled job per feed (Vercel cron or worker). Streams+parses XML (SAX-style; feeds can be 100k+ products), upserts products in batches, marks missing products unavailable.
3. **Field mapping UI** for generic XML/CSV: sample the feed, show detected fields, drag-map to canonical fields, save as feed.field_mapping.
4. **Feed health**: hash comparison to detect stale feeds; error states (unreachable, parse failure, 0 products, >X% products dropped) flip status and trigger alerts. **Widgets bound to a failing feed automatically fall back or hide** — never show stale prices (Danish marketing-law hygiene).
5. **Price freshness rule**: product data older than a configurable max age (default 24h) is not renderable.

---

## 5. Contextual engine — two levels

### Level A: which widget (placement rules)
The embed references a **placement**, not a widget. At serve time the resolver evaluates the placement's ordered rules against the page's key-values and returns the winning widget instance (or nothing). This enables the fyens.dk scenario: one placement in the article template, 10–20 widget instances behind it, `category=gaming, platform=xbox` → Xbox widget.

### Level B: which products (instance mappings)
Inside the chosen instance, kv_mappings translate page KVs into product segments: `recipe_type=pork` → products tagged/filtered for pork pairing. Fallback: instance default set → hide.

### Key-value acquisition (client)
- **Direct script tag**: read `googletag.pubads().getTargeting(key)` for the configured keys; fall back to `dataLayer` lookups; final fallback: explicit `data-kv` attributes on the embed tag (publisher can hardcode).
- **GAM-served**: the HTML5 creative **cannot reliably reach `googletag` from inside a SafeFrame**, so the creative passes key-values via GAM macros — `%%PATTERN:recipe_type%%` etc. — injected into the loader config at render time. This is the primary reason GAM delivery is first-class, not an afterthought.
- All resolution happens **server-side** at `/serve` given the KV payload; the client never contains mapping tables.

---

## 6. Widget system

### Design tokens (the styling contract)
JSONB schema covering: color roles (background, surface, text primary/secondary, price, CTA bg/text, border), typography (font family with web-safe fallback stack, sizes, weights), spacing scale, corner radius, shadow, image treatment (ratio, fit, hover), card layout (image position, title lines clamp, price style, CTA style: button/link/arrow), carousel behaviour (autoplay, controls), badge styles ("Tilbud", "-20%"), and an `custom_css` escape hatch (scoped, admin-only). Tokens render inside **Shadow DOM** so publisher CSS can't break the widget and vice versa.

### Sizing model
- An instance defines **named size variants**: e.g. `desktop: 930×180 (6-product carousel)`, `tablet: 728×250 (4 products)`, `mobile: 300×320 (2 stacked cards)` — each with its own layout choice.
- OR `fluid`: the widget measures its container (ResizeObserver) and picks a layout from template-defined container breakpoints.
- Explicit sizes matter for GAM (line-item/creative sizes); fluid mode targets direct on-page embeds.

### Template → instance → variant
Template holds the design + layout. Instance binds it to a site with mappings, sizes, and overrides; restyling a template propagates to all instances unless overridden. Variants (V2) fork any part of an instance for testing. Duplicate instance = copy with cleared site binding + mappings.

### AI styling (V3)
Prompt/brief/screenshot → filled token schema via LLM with the schema as the constrained output format. Human previews and adjusts. Never generates arbitrary CSS/JS.

---

## 7. Delivery

### Embed (direct)
```html
<script async src="https://widgets.stepnetwork.dk/w.js"
        data-placement="PLC_abc123"></script>
```
Loader (`w.js`, target < 10 KB): collects KVs, viewport/container info, consent-independent context → calls `/serve` → receives instance config + resolved products + tokens → renders into Shadow DOM. Full render bundle < 30 KB gzipped, zero dependencies, lazy-loads images.

### GAM / DFP
An HTML5 custom creative wrapping the same loader, with `%%PATTERN%%` macros for KVs and `%%CLICK_URL_UNESC%%` compatibility for GAM click tracking parity. Benefits inherited from GAM: targeting on the same KVs, frequency capping, priority vs. other line items, trafficking workflow ad ops already runs. Recommended default for network rollout; direct embed for placements outside the ad stack.

### Serve API
`POST /api/serve` — input: placement code, KV map, size hints, variant stickiness seed. Output: instance id, variant id, product payload (only renderable fields), tokens, tracking tokens. Edge-cached per (placement, KV-signature, variant) with short TTL (60–300 s). p95 target < 120 ms.

### Ad-blocker mitigation
First-party-friendly: offer publishers a CNAME (`shop.publisherdomain.dk → widgets.stepnetwork.dk`) and keep the script path non-signalling (no "ads" in URLs). GAM-served mode accepts normal ad-block loss. Measure blocked rate via a lightweight beacon diff.

---

## 8. Tracking & measurement

**Events**: `load` (serve rendered), `viewable` (IntersectionObserver ≥50% for 1 s), `product_impression` (per product actually in view), `click`.

**Clicks** route through a first-party redirect: `GET /c/{click_id}` → logs → 302 to destination. Destination = product link (direct deals) or affiliate deeplink with `subid=click_id` (backfill). This gives one canonical click log across all pricing models.

**Conversions**: V2 — nightly import of affiliate network transaction reports matched on SubID. V3 — S2S postback endpoint for direct CPA deals (`/pb?click_id=...&value=...`).

**Quality**: dedupe window (same visitor+product < 10 s), bot UA/IP filtering, CTR anomaly flags. Billable vs. raw clicks both stored.

**Privacy stance** (per product decision): targeting is 100% contextual (page KVs), no user IDs, no cookies for targeting; variant stickiness uses a non-identifying local random seed. Measurement is aggregate. Therefore no TCF gate on rendering or counting. Affiliate networks' own cookies fire on the merchant side under their compliance. Revisit only if user-level features are ever added.

**Reporting UI**: dashboards per advertiser / site / placement / instance / variant / product / KV segment, with the headline comparison **widget RPM vs. display RPM on the same slot** — the number that sells the product. Exports for invoicing.

---

## 9. Monetisation engine

- **Pricing config per instance_advertiser**: model + rate + floor + optional manual weight + optional guaranteed share (for fixed deals).
- **V2 allocation**: manual weights / round-robin within weights; affiliate fills any slot where no direct advertiser has eligible products or clears its floor.
- **V3 allocation**: eCPM normalisation (see §2/V3) ranks eligible candidates per slot; Thompson sampling explores; manual weight always pins. **Ladder is hard-coded policy: direct CPC/CPM first, affiliate only as backfill**, exclusive mode bypasses allocation entirely.
- **Cold start**: synthetic CTR prior + minimum exploration share until N=1,000 product impressions (configurable), then decay.

---

## 10. Split testing

- V2: manual — create variants, set shares, sticky assignment, report loads/viewability/CTR/eCPM per variant with a two-proportion significance check. Variants may differ on styling, product logic, advertiser mix, or pricing.
- V3: auto — bandit continuously shifts traffic toward the highest eCPM variant within guardrails (min share per variant, exploration floor), with a one-click "freeze winner".

---

## 11. Admin application (internal, V1–V2)

Screens: **Advertisers** (list/detail, feeds, programmes) · **Feeds** (mapping UI, health, product browser with rule builder + live preview of matching products) · **Templates** (token editor with live rendered preview across size variants) · **Instances** (per site; mapping table with bulk paste import; duplicate) · **Placements** (rule builder; embed/GAM snippet generator) · **Variants & tests** · **Reporting** · **Settings** (affiliate networks, quality rules, alert channels). Auth: STEP internal SSO/email; roles admin/ops/readonly. Publisher-facing portal deferred to V3 decision.

---

## 12. Tech architecture

- **Admin + APIs**: Next.js 15 (App Router) on Vercel. **DB**: Neon Postgres. **Jobs**: Vercel cron for feed fetch + aggregation; heavier fetches to a worker (e.g. Railway/Fly) if streaming limits bite.
- **Widget**: separate build artefact — vanilla TS, esbuild, no framework, Shadow DOM, served via Vercel edge/CDN with immutable versioned URLs + a stable `w.js` alias.
- **Event ingestion**: edge function → Neon (V1); if volume grows, buffer via queue (Upstash) and batch-insert. Hourly rollups.
- **Consistency with STEP side-stack** (Slushbible, Newsroom Radar): same deploy/DB/tooling patterns, minimal new operational surface.

---

## 13. KPIs and success gates

Pilot (V1, wine × recipes on madensverden.dk-type site): widget RPM ≥ 2× same-slot display RPM within 8 weeks; viewability ≥ 60%; CTR ≥ 0.8% on mapped pages; feed uptime ≥ 99%. V2 gate: ≥ 3 paying CPC advertisers, affiliate backfill fill-rate ≥ 90% of unsold slots. V3 gate: auto-optimisation beats manual allocation by ≥ 15% eCPM in an A/A/B trial. Hard rule: if the pilot doesn't beat display RPM by the January review, kill or rework — decided in advance.

---

## 14. Reference implementations (approved prototypes — build these as V1 template layouts)

Two working HTML prototypes exist and are approved as the design direction. Both must become standard widget **templates** in V1. Files: `lds-haraldnyborg-widget-prototype.html`, `madensverden-vin-widget-prototype.html`.

### Template A — "Native forum post" (case: lav-det-selv.dk × Harald Nyborg)
The widget renders as a forum post inside the thread flow: host-site card styling, advertiser logo as avatar, advertiser name as username with a "Sponsoreret" badge mirroring the forum's own badges, timestamp slot, discreet uppercase "ANNONCE" top-right (Danish marketing-law marking — present but quiet). Content blocks: (1) short conversational copy written in forum voice, contextualised to the thread topic; (2) a **tilbudsavis component**: mini catalogue with front page (advertiser gradient + logo + price splash) and 2+ spread pages of offers, auto page-flip every ~2.6 s with a continuously "peeling" corner, click anywhere = CTA; (3) an optional **context strip** ("Relevant for denne tråd") with 2–3 offers matched to the page's key-values; (4) CTA button in advertiser colours with optional pulse. All animation respects `prefers-reduced-motion`. Learnings locked in: real advertiser identity matters (HN = navy `#10357F` / blue `#0097D6` / yellow `#FFED00`, red `#E40712` for prices only — the placeholder red read as wrong immediately); assets must come from the advertiser feed/agreement, never scraped in production.

### Template B — "Native recipe section" (case: madensverden.dk, vinanbefaling)
The widget renders as one of the host site's own content sections, inserted after "Fremgangsmåde": identical section-header pattern (icon + serif heading + hairline rule + chevron) with quiet "ANNONCE" label, then a host-styled card containing: (1) a **match line** explaining the selection in plain Danish with ingredient chips ("Udvalgt til opskriftens ingredienser: svinekød · skinke · rosmarin"); (2) three product cards (CSS bottle illustration or feed image, name, type/origin, **match-score bar** animated on viewability via IntersectionObserver, a one-line "derfor" pairing explanation, price, CTA); (3) footer with advertiser attribution + "Hvorfor ser jeg denne?". The "Bedste match" badge marks the ranked winner.

### Real key-value example (madensverden.dk, captured from GAM console)
Page-level targeting actually present in production and available to the widget:
`mv_cat: aftensmad` · `mv_ingredients: skinkeschnitzler, salt og friskkværnet peber, rosmarin, Fanø skinke, hvedemel, …` · `mv_keywords` · `mv_calories: 253 kcal` · `mv_recipeYield: 4 personer` · `mv_cookTime: 5m` · `mv_totalTime: 15m` · `mv_page: artikel` · `Domain: madensverden.dk` · `step_contextual: Food_and_Drink, …` · `digiseg: …` · `limited_ads: false` · slot-level `refresh: true`.

Mapping pipeline demonstrated: `mv_ingredients` → tokenise → ingredient dictionary (skinkeschnitzler/skinke ⇒ **svinekød**) → derived segment `svinekød / let ret` → product rule `pairing IN (svinekød) AND body <= medium`. This confirms design decisions: mappings must support **substring/dictionary matching on multi-value KVs** (not only exact equality), a per-site **ingredient/term dictionary** is a first-class mapping asset, `mv_cat` can drive placement-level widget selection while `mv_ingredients` drives product selection, and `limited_ads` should be respected as a serve-time signal.

## 15. Build order for the AI agent (V1)

1. Schema + migrations (§3, V1 subset). 2. Feed fetcher + Google Shopping parser + product browser. 3. Product rules engine + preview. 4. Template/token system + renderer (build widget bundle first as a standalone playground). 5. Instance + mapping + placement resolver + `/serve`. 6. Embed loader + GAM creative wrapper. 7. Event ingestion + redirect + rollups + dashboard. 8. Feed health + fallback behaviour. 9. Deploy, CNAME setup, pilot instance.

Each step independently demoable; widget playground (step 4) is the earliest visible artefact for stakeholder feedback.
