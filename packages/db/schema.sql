-- STEP Commerce — Postgres schema, V1 "Exclusive" subset (spec §3)
-- V2-only tables (variant, conversion, affiliate_programme) are deliberately
-- absent; columns that reference them (event.variant_id) exist as nullable
-- so V1 event data survives the V2 migration unchanged.

create extension if not exists pgcrypto;

-- Applied migration bookkeeping. schema.sql is the baseline (version 1);
-- everything after it lives in packages/db/migrations/NNN_*.sql and is applied
-- in order by `npm run migrate`. See migrate.mjs.
create table schema_migration (
  version    int primary key,
  name       text not null,
  applied_at timestamptz not null default now()
);
insert into schema_migration (version, name) values (1, 'baseline');

-- --------------------------------------------------------------------- asset
-- Small binary assets (advertiser logos). Kept in Postgres rather than a blob
-- service: a logo is a few KB, it must be served alongside the widget, and this
-- avoids a second provider to configure. The widget only ever sees a URL, so
-- this is swappable.
create table asset (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null,
  content_type text not null,
  bytes        bytea not null,
  byte_size    int not null,
  width        int,
  height       int,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- advertiser
create table advertiser (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  company_info    jsonb not null default '{}',
  billing_contact text,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  website         text,
  logo_asset_id   uuid,           -- references asset(id), set after asset exists
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
                 -- 'manual' feeds hold hand-created products (e.g. affiliate
                 -- items with no XML source). They are never fetched and are
                 -- exempt from fetch-freshness checks.
                 check (type in ('google_shopping_xml', 'generic_xml', 'csv', 'manual')),
  field_mapping  jsonb,                -- non-Google formats: {canonical_field: source_field}
  fetch_schedule text not null default '0 * * * *',
  last_fetch_at  timestamptz,
  last_fetch_hash text,               -- content hash for stale-feed detection
  status         text not null default 'healthy' check (status in ('healthy', 'stale', 'failing')),
  error_log      jsonb not null default '[]',
  max_age_hours  int not null default 24,   -- price-freshness rule (spec §4.5)
  -- Last time the fetched CONTENT actually differed (hash comparison, §4.4).
  -- A feed frozen behind a CDN keeps fetching fine but must still go stale.
  content_changed_at timestamptz,
  -- Non-Google XML: element that wraps one product, when it is not <item>.
  item_element   text,
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
  affiliate_url           text,          -- preferred click destination when set
  manual                  boolean not null default false,
  sort_order              int,
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
  -- Templates are saved copies of a widget that was actually built, not
  -- hand-authored records.
  created_from_instance_id uuid,
  widget_type   text,
  meta          jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------- site
create table site (
  id          uuid primary key default gen_random_uuid(),
  publisher   text not null,
  domain      text not null unique,
  -- Structured so the wizard can offer keys AND their known values:
  -- {"keys": [{"key": "mv_cat", "values": ["aftensmad", "frokost"]}]}
  kv_taxonomy jsonb not null default '{}',
  notes       text,
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
  -- 'shared' lets several advertisers compete for the widget's slots; each
  -- contributes products through instance_source.
  mode            text not null default 'exclusive' check (mode in ('exclusive', 'shared')),
  -- product_match = feed-driven recommendations; takeover = branding unit that
  -- may carry no feed at all.
  widget_type     text not null default 'product_match'
                  check (widget_type in ('product_match', 'takeover')),
  wizard_step     int not null default 0,
  size_config     jsonb not null default '{"mode": "fluid"}',
  token_overrides jsonb not null default '{}',
  fallback_config jsonb not null default '{"strategy": "hide"}',
  -- {"strategy": "default_products", "product_source": {...}} | {"strategy": "hide"}
  status          text not null default 'draft' check (status in ('draft', 'live', 'paused', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- --------------------------------------------------------- instance_advertiser
-- One row per advertiser participating in the widget. COMMERCIAL TERMS live
-- here; which products they contribute lives in instance_source.
--
-- pricing: {"models": ["cpc","cpm","affiliate","fixed"], "currency": "DKK",
--           "cpc": 2.50, "cpm": 30, "fixed": 5000,
--           "affiliate": {"network": "adtraction",
--                         "deeplink_template": "https://...?url={url}&subid={click_id}"}}
-- A widget may combine models; each selected model is recorded and reported.
create table instance_advertiser (
  id             uuid primary key default gen_random_uuid(),
  instance_id    uuid not null references widget_instance(id) on delete cascade,
  advertiser_id  uuid not null references advertiser(id),
  product_source jsonb,               -- legacy single-source shorthand; prefer instance_source
  pricing        jsonb not null default '{}',
  pricing_model  text not null default 'fixed' check (pricing_model in ('cpc', 'cpm', 'fixed', 'affiliate')),
  rate           numeric(12,4),
  weight         int,                 -- optional manual rotation weight
  priority       int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (instance_id, advertiser_id)
);

-- ------------------------------------------------------------ instance_source
-- One row per product contribution: an advertiser's feed plus the conditions
-- that select from it, with an optional cap. This is what lets a single wine
-- widget pull 10 products from one chain's feed, 100 from another and 2 from a
-- third. conditions uses the same shape as product_rule.conditions; null means
-- the whole feed.
create table instance_source (
  id            uuid primary key default gen_random_uuid(),
  instance_id   uuid not null references widget_instance(id) on delete cascade,
  advertiser_id uuid not null references advertiser(id) on delete cascade,
  feed_id       uuid not null references feed(id) on delete cascade,
  name          text,
  conditions    jsonb,
  max_products  int,
  priority      int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index instance_source_idx on instance_source (instance_id, priority);

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
  source_id     uuid,                  -- which instance_source contributed it
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
  -- nullable: a click can arrive without a resolvable instance (copied link,
  -- an instance deleted after the page was cached). Losing the instance must
  -- not lose the click.
  instance_id uuid,
  placement_id uuid,
  destination text not null,
  created_at  timestamptz not null default now(),
  redeemed_at timestamptz
);

-- ------------------------------------------------------------ serve_decision
-- Counts every /api/serve outcome per hour, INCLUDING the no-render reasons.
-- Without this a misspelled key-value, a paused instance or an empty rule is
-- indistinguishable from "no traffic yet": the widget fails silent by design,
-- so the only signal is here.
create table serve_decision (
  hour         timestamptz not null,
  placement_id uuid not null,
  reason       text not null,   -- 'rendered' | no_rule_match | no_products | limited_ads | ...
  count        bigint not null default 0,
  primary key (hour, placement_id, reason)
);

-- ------------------------------------------------------------- feed_fetch_log
-- One row per fetch attempt, so feed uptime (spec §13: >= 99%) is computable
-- and an overnight breakage is visible the next morning.
create table feed_fetch_log (
  id         bigint generated always as identity primary key,
  feed_id    uuid not null references feed(id) on delete cascade,
  ok         boolean not null,
  status     text not null,
  products   int not null default 0,
  dropped    int not null default 0,
  content_changed boolean,
  error      text,
  ts         timestamptz not null default now()
);
create index feed_fetch_log_idx on feed_fetch_log (feed_id, ts desc);

alter table advertiser add constraint advertiser_logo_fk
  foreign key (logo_asset_id) references asset(id) on delete set null;

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
