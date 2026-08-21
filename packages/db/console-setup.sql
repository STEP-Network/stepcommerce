-- ============================================================================
-- STEP Commerce — komplet engangs-bootstrap til delt Neon-database.
-- GENERERET af build-console-sql.mjs — redigér ikke i hånden.
--
-- Sådan bruges den (Neon console → SQL Editor, database: neondb):
--   1. Erstat __CHANGE_ME__ nedenfor med et stærkt password.
--   2. Kør hele filen én gang.
--   3. Sæt DATABASE_URL i Vercel til stepcommerce_app-rollens connection
--      string (host/db fra Neon console, user stepcommerce_app + dit password).
--
-- Alt ligger i schemaet "stepcommerce" — public røres ikke.
-- ============================================================================

-- 1) Schema + app-rolle ------------------------------------------------------
create schema if not exists stepcommerce;

do $$
begin
  if not exists (select from pg_roles where rolname = 'stepcommerce_app') then
    create role stepcommerce_app login password '__CHANGE_ME__';
  end if;
end $$;

grant usage, create on schema stepcommerce to stepcommerce_app;
alter role stepcommerce_app set search_path = stepcommerce;
create extension if not exists pgcrypto;

set search_path = stepcommerce, public;

-- 2) Tabeller (fra schema.sql) ----------------------------------------------
-- STEP Commerce — Postgres schema, V1 "Exclusive" subset (spec §3)
-- V2-only tables (variant, conversion, affiliate_programme) are deliberately
-- absent; columns that reference them (event.variant_id) exist as nullable
-- so V1 event data survives the V2 migration unchanged.


-- ---------------------------------------------------------------- advertiser
create table advertiser (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  company_info    jsonb not null default '{}',
  billing_contact text,
  status          text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------- feed
create table feed (
  id             uuid primary key default gen_random_uuid(),
  advertiser_id  uuid not null references advertiser(id) on delete cascade,
  name           text not null,
  source_url     text not null,
  type           text not null default 'google_shopping_xml'
                 check (type in ('google_shopping_xml', 'generic_xml', 'csv')),
  field_mapping  jsonb,                -- non-Google formats: {canonical_field: source_field}
  fetch_schedule text not null default '0 * * * *',
  last_fetch_at  timestamptz,
  last_fetch_hash text,               -- content hash for stale-feed detection
  status         text not null default 'healthy' check (status in ('healthy', 'stale', 'failing')),
  error_log      jsonb not null default '[]',
  max_age_hours  int not null default 24,   -- price-freshness rule (spec §4.5)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------------- product
-- Canonical schema = Google Shopping. Upserted per fetch on (feed_id, external_id);
-- products missing from the latest fetch are soft-deleted via available=false.
create table product (
  id                      uuid primary key default gen_random_uuid(),
  feed_id                 uuid not null references feed(id) on delete cascade,
  external_id             text not null,
  title                   text not null,
  description             text,
  link                    text not null,
  image_link              text,
  additional_images       jsonb not null default '[]',
  price_amount            numeric(12,2),
  price_currency          text,
  sale_price_amount       numeric(12,2),
  sale_price_currency     text,
  availability            text,
  brand                   text,
  gtin                    text,
  product_type            text,
  google_product_category text,
  custom_label_0          text,
  custom_label_1          text,
  custom_label_2          text,
  custom_label_3          text,
  custom_label_4          text,
  raw                     jsonb not null default '{}',
  available               boolean not null default true,  -- false = missing from latest fetch
  last_seen_at            timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (feed_id, external_id)
);
create index product_feed_idx on product (feed_id) where available;
create index product_labels_idx on product (feed_id, custom_label_0) where available;

-- -------------------------------------------------------------- product_rule
-- Reusable filter. conditions = {"any": [...]} | {"all": [...]} | flat array (implicit AND)
-- leaf: {"field": "custom_label_0", "operator": "equals", "value": "ugens_tilbud"}
-- operators: equals | contains | in | gt | lt | exists
create table product_rule (
  id         uuid primary key default gen_random_uuid(),
  feed_id    uuid not null references feed(id) on delete cascade,
  name       text not null,
  conditions jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------- widget_template
create table widget_template (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  layout_type   text not null check (layout_type in ('carousel', 'grid', 'stacked', 'single_card', 'forum_post', 'recipe_section')),
  design_tokens jsonb not null default '{}',   -- token schema, spec §6
  slot_count    jsonb not null default '{"default": 3}',
  behaviours    jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------- site
create table site (
  id          uuid primary key default gen_random_uuid(),
  publisher   text not null,
  domain      text not null unique,
  kv_taxonomy jsonb not null default '{}',   -- documented key-value keys on the site
  contact     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------ widget_instance
create table widget_instance (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references widget_template(id),
  site_id         uuid not null references site(id),
  name            text not null,
  mode            text not null default 'exclusive' check (mode = 'exclusive'),  -- V1: exclusive only
  size_config     jsonb not null default '{"mode": "fluid"}',
  token_overrides jsonb not null default '{}',
  fallback_config jsonb not null default '{"strategy": "hide"}',
  -- {"strategy": "default_products", "product_source": {...}} | {"strategy": "hide"}
  status          text not null default 'draft' check (status in ('draft', 'live', 'paused', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- --------------------------------------------------------- instance_advertiser
-- V1: exactly one row per instance (exclusive). Kept relational for V2.
-- product_source: {"kind": "rule", "rule_id": ...} | {"kind": "explicit", "product_ids": [...]}
--               | {"kind": "full_feed", "feed_id": ...}
create table instance_advertiser (
  id             uuid primary key default gen_random_uuid(),
  instance_id    uuid not null references widget_instance(id) on delete cascade,
  advertiser_id  uuid not null references advertiser(id),
  product_source jsonb not null,
  pricing_model  text not null default 'fixed' check (pricing_model in ('cpc', 'cpm', 'fixed')),
  rate           numeric(12,4),        -- reported CPC/CPM even on fixed deals (rate card for V2)
  priority       int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (instance_id)                 -- V1 exclusivity: one advertiser per instance
);

-- ----------------------------------------------------------------- placement
-- The embed references a placement, never an instance directly (spec §5A).
-- rules: ordered [{"match": {"key", "operator": "eq"|"contains"|"dict", "value"|"dict_id"}, "instance_id"}]
create table placement (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references site(id),
  name                text not null,
  code                text not null unique,   -- PLC_xxx, referenced by embed/GAM creative
  rules               jsonb not null default '[]',
  default_instance_id uuid references widget_instance(id),  -- null → render nothing
  status              text not null default 'live' check (status in ('live', 'paused', 'archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------- dictionary
-- Per-site term dictionary for multi-value KV matching (spec §14):
-- mv_ingredients "skinkeschnitzler" ⇒ segment "svinekød".
create table kv_dictionary (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references site(id) on delete cascade,
  name       text not null,
  entries    jsonb not null default '{}',   -- {"term": "segment", ...} terms matched as substrings, lowercased
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- kv_mapping
-- Level B: page KV → product segment inside the chosen instance (spec §5B).
-- operator eq: page_value equals value; contains: page value contains value as substring/token;
-- dict: tokenize page value through kv_dictionary → match segment.
-- target: {"kind": "rule", "rule_id": ...} | {"kind": "explicit", "product_ids": [...]}
create table kv_mapping (
  id          uuid primary key default gen_random_uuid(),
  instance_id uuid not null references widget_instance(id) on delete cascade,
  page_key    text not null,
  operator    text not null default 'eq' check (operator in ('eq', 'contains', 'dict')),
  page_value  text,                    -- for eq/contains
  dict_id     uuid references kv_dictionary(id),
  segment     text,                    -- for dict: the segment the dictionary must produce
  target      jsonb not null,
  priority    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index kv_mapping_instance_idx on kv_mapping (instance_id, priority);

-- --------------------------------------------------------------------- event
-- Append-only. Raw events retained ≥ 13 months (prune job is V2 ops).
create table event (
  id            bigint generated always as identity primary key,
  type          text not null check (type in ('load', 'viewable', 'product_impression', 'click')),
  placement_id  uuid,
  instance_id   uuid,
  variant_id    uuid,                  -- always null in V1
  advertiser_id uuid,
  product_id    uuid,
  site_id       uuid,
  kv_context    jsonb not null default '{}',
  device_class  text,
  click_id      uuid,                  -- clicks only
  quality_flags jsonb not null default '[]',
  ts            timestamptz not null default now()
);
create index event_ts_idx on event (ts);
create index event_click_idx on event (click_id) where click_id is not null;

-- --------------------------------------------------------------------- click
-- Pending redirect targets: /c/{click_id} looks up destination, logs event, 302s.
create table click (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references product(id),
  instance_id uuid not null,
  placement_id uuid,
  destination text not null,
  created_at  timestamptz not null default now(),
  redeemed_at timestamptz
);

-- --------------------------------------------------------------- stats_hourly
-- Dimensions are not null: the rollup coalesces missing uuids to the zero uuid
-- and missing device_class to 'unknown' so the primary key stays valid.
create table stats_hourly (
  hour                timestamptz not null,
  placement_id        uuid not null,
  instance_id         uuid not null,
  advertiser_id       uuid not null,
  site_id             uuid not null,
  device_class        text not null default 'unknown',
  loads               bigint not null default 0,
  viewables           bigint not null default 0,
  product_impressions bigint not null default 0,
  clicks              bigint not null default 0,
  primary key (hour, placement_id, instance_id, advertiser_id, site_id, device_class)
);


grant all on all tables in schema stepcommerce to stepcommerce_app;
grant all on all sequences in schema stepcommerce to stepcommerce_app;
alter default privileges in schema stepcommerce grant all on tables to stepcommerce_app;
alter default privileges in schema stepcommerce grant all on sequences to stepcommerce_app;

-- 3) Pilot-seed (spejler seed.mjs): madensverden.dk × vin, demo-feed ---------
do $$
declare
  v_adv  uuid; v_feed uuid; v_site uuid; v_dict uuid; v_tpl uuid; v_inst uuid; v_rule uuid;
  v_segment text; v_prio int := 0;
begin
  if exists (select from stepcommerce.placement where code = 'PLC_mv_recipe') then
    raise notice 'Seed springes over — PLC_mv_recipe findes allerede.';
    return;
  end if;

  insert into stepcommerce.advertiser (name, company_info)
  values ('Pilot Vinhandel (demo)', '{"note": "pilot advertiser — replace with signed partner"}')
  returning id into v_adv;

  insert into stepcommerce.feed (advertiser_id, name, source_url, type)
  values (v_adv, 'Vin — demo-feed',
          'https://stepcommerce.vercel.app/stepcommerce/api/demo-feed', 'google_shopping_xml')
  returning id into v_feed;

  insert into stepcommerce.site (publisher, domain, kv_taxonomy)
  values ('Madens Verden', 'madensverden.dk',
          '{"keys": ["mv_cat", "mv_ingredients", "mv_keywords", "mv_page", "Domain", "step_contextual", "limited_ads"]}')
  returning id into v_site;

  insert into stepcommerce.kv_dictionary (site_id, name, entries)
  values (v_site, 'Ingredienser → pairing-segment', '{
    "skinkeschnitzler": "svinekød", "skinke": "svinekød", "flæsk": "svinekød",
    "nakkefilet": "svinekød", "svinemørbrad": "svinekød", "bacon": "svinekød",
    "frikadeller": "svinekød",
    "oksemørbrad": "oksekød", "hakket oksekød": "oksekød", "entrecote": "oksekød",
    "culotte": "oksekød", "oksesteg": "oksekød", "bøf": "oksekød",
    "kylling": "fjerkræ", "kyllingebryst": "fjerkræ", "kalkun": "fjerkræ", "and": "fjerkræ",
    "torsk": "fisk", "laks": "fisk", "rødspætte": "fisk", "rejer": "fisk", "muslinger": "fisk",
    "pasta": "pasta", "spaghetti": "pasta", "lasagne": "pasta", "risotto": "pasta"
  }')
  returning id into v_dict;

  insert into stepcommerce.widget_template (name, layout_type, design_tokens, slot_count)
  values ('Native recipe section', 'recipe_section', '{
    "colorBackground": "transparent", "colorSurface": "#fffdf8", "colorText": "#23211b",
    "colorTextSecondary": "#8a8574", "colorPrice": "#23211b",
    "colorCtaBg": "#7a2f3a", "colorCtaText": "#f7ecd9", "colorBorder": "#eae5d6",
    "colorAccent": "#7a2f3a", "colorAccentSecondary": "#a4485a",
    "colorBadgeBg": "#7a2f3a", "colorBadgeText": "#f7ecd9",
    "fontFamily": "\"Segoe UI\", system-ui, -apple-system, Arial, sans-serif",
    "headingFontFamily": "Georgia, \"Times New Roman\", serif",
    "fontSizeBase": "15.5px", "radius": "12px", "shadow": "0 1px 2px rgba(60,55,40,.05)"
  }', '{"default": 3}')
  returning id into v_tpl;

  insert into stepcommerce.widget_instance (template_id, site_id, name, token_overrides, fallback_config, status)
  values (v_tpl, v_site, 'Vin til opskrifter — madensverden.dk', '{
    "__meta": {
      "sectionHeading": "Vin til denne ret",
      "matchLine": "Udvalgt til opskriftens ingredienser:",
      "bestMatchLabel": "Bedste match",
      "whyLabel": "Hvorfor ser jeg denne?",
      "whyText": "Anbefalingen er valgt ud fra opskriftens ingredienser — ikke ud fra dig. Vi bruger hverken cookies eller personlige oplysninger."
    }
  }', '{"strategy": "hide"}', 'live')
  returning id into v_inst;

  insert into stepcommerce.instance_advertiser (instance_id, advertiser_id, product_source, pricing_model, rate)
  values (v_inst, v_adv,
          jsonb_build_object('kind', 'full_feed', 'feed_id', v_feed::text), 'fixed', 3.50);

  foreach v_segment in array array['svinekød', 'oksekød', 'fjerkræ', 'fisk', 'pasta'] loop
    insert into stepcommerce.product_rule (feed_id, name, conditions)
    values (v_feed, 'Pairing: ' || v_segment, jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field', 'custom_label_0', 'operator', 'equals', 'value', v_segment),
        jsonb_build_object('field', 'availability', 'operator', 'equals', 'value', 'in stock')
      )))
    returning id into v_rule;

    insert into stepcommerce.kv_mapping (instance_id, page_key, operator, dict_id, segment, target, priority)
    values (v_inst, 'mv_ingredients', 'dict', v_dict, v_segment,
            jsonb_build_object('kind', 'rule', 'rule_id', v_rule::text), v_prio);
    v_prio := v_prio + 1;
  end loop;

  insert into stepcommerce.placement (site_id, name, code, rules, default_instance_id)
  values (v_site, 'Efter fremgangsmåde — artikel', 'PLC_mv_recipe',
          jsonb_build_array(jsonb_build_object(
            'match', jsonb_build_object('key', 'mv_page', 'operator', 'eq', 'value', 'artikel'),
            'instance_id', v_inst::text)),
          null);

  raise notice 'Pilot seedet: placement PLC_mv_recipe → instans %', v_inst;
end $$;
