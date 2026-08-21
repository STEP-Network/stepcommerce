-- 003: shared widgets (many advertisers, many feeds, conditions per feed),
-- advertiser identity/contacts, manual products, and the wizard's widget model.
--
-- V-boundary note: this deliberately opens the V2 "shared widget" model. The
-- product decision (aug 2026) was to build the monetisation engine now, with
-- affiliate kept simple (manual products + affiliate links). CLAUDE.md's V1
-- boundary is superseded for these areas.
--
-- Every statement is idempotent so a partial apply can be re-run.

-- ---------------------------------------------------------------- advertiser
alter table advertiser add column if not exists contact_name  text;
alter table advertiser add column if not exists contact_email text;
alter table advertiser add column if not exists contact_phone text;
alter table advertiser add column if not exists logo_asset_id uuid;
alter table advertiser add column if not exists website text;

-- Small binary assets (advertiser logos). Kept in Postgres rather than a blob
-- service: a logo is a few KB, it must be served with the widget, and this
-- avoids a second provider + token to configure. Swappable later — the widget
-- only ever sees a URL.
create table if not exists asset (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null,
  content_type text not null,
  bytes        bytea not null,
  byte_size    int not null,
  width        int,
  height       int,
  created_at   timestamptz not null default now()
);

do $$ begin
  alter table advertiser add constraint advertiser_logo_fk
    foreign key (logo_asset_id) references asset(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------- feed
-- 'manual' feeds hold hand-created products (e.g. affiliate-linked items with
-- no XML source). They are never fetched, and must not be judged by fetch
-- freshness — the admin maintains them.
do $$ begin
  alter table feed drop constraint if exists feed_type_check;
  alter table feed add constraint feed_type_check
    check (type in ('google_shopping_xml', 'generic_xml', 'csv', 'manual'));
exception when others then null; end $$;

-- ------------------------------------------------------------------- product
-- Manual/affiliate products: the click redirect prefers affiliate_url when set.
alter table product add column if not exists affiliate_url text;
alter table product add column if not exists manual boolean not null default false;
alter table product add column if not exists sort_order int;

-- ------------------------------------------------------------ widget_instance
-- widget_type separates the two things being sold: a feed-driven product-match
-- widget, and a takeover/branding widget that may carry no feed at all.
alter table widget_instance add column if not exists widget_type text
  not null default 'product_match';
do $$ begin
  alter table widget_instance add constraint widget_instance_type_check
    check (widget_type in ('product_match', 'takeover'));
exception when duplicate_object then null; end $$;

-- Shared widgets are now allowed: several advertisers compete for the slots.
do $$ begin
  alter table widget_instance drop constraint if exists widget_instance_mode_check;
  alter table widget_instance add constraint widget_instance_mode_check
    check (mode in ('exclusive', 'shared'));
exception when others then null; end $$;

-- Wizard progress, so a half-finished widget can be resumed.
alter table widget_instance add column if not exists wizard_step int not null default 0;

-- --------------------------------------------------------- instance_advertiser
-- One row per advertiser participating in the widget (was: exactly one).
-- Commercial terms live here; product contribution moves to instance_source.
alter table instance_advertiser drop constraint if exists instance_advertiser_instance_id_key;
do $$ begin
  alter table instance_advertiser
    add constraint instance_advertiser_uniq unique (instance_id, advertiser_id);
exception when duplicate_object then null; end $$;

-- pricing: {"models": ["cpc","cpm","affiliate","fixed"],
--           "cpc": 2.50, "cpm": 30, "fixed": 5000, "currency": "DKK",
--           "affiliate": {"network": "adtraction", "deeplink_template": "...{url}...{subid}"}}
-- A widget may combine models; every selected model is recorded and reported.
alter table instance_advertiser add column if not exists pricing jsonb not null default '{}';
alter table instance_advertiser add column if not exists weight int;
alter table instance_advertiser alter column product_source drop not null;

-- ------------------------------------------------------------ instance_source
-- One row per product contribution: an advertiser's feed plus the conditions
-- that select from it, with an optional cap. This is what lets one wine widget
-- pull 10 products from Coop, 100 from Salling and 2 from Dagrofa.
create table if not exists instance_source (
  id            uuid primary key default gen_random_uuid(),
  instance_id   uuid not null references widget_instance(id) on delete cascade,
  advertiser_id uuid not null references advertiser(id) on delete cascade,
  feed_id       uuid not null references feed(id) on delete cascade,
  name          text,
  -- Same shape as product_rule.conditions; null means "everything in the feed".
  conditions    jsonb,
  -- Cap on how many products this source may contribute to the pool.
  max_products  int,
  priority      int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists instance_source_idx on instance_source (instance_id, priority);

-- ---------------------------------------------------------------------- site
-- kv_taxonomy becomes structured so the wizard can offer the keys AND their
-- known values: {"keys": [{"key": "mv_cat", "values": ["aftensmad", ...]}]}
alter table site add column if not exists notes text;

-- ------------------------------------------------------------ widget_template
-- Templates are saved copies of a built widget, not hand-authored records.
alter table widget_template add column if not exists created_from_instance_id uuid;
alter table widget_template add column if not exists meta jsonb not null default '{}';
alter table widget_template add column if not exists widget_type text;

-- --------------------------------------------------------------------- event
-- Which source/advertiser a product came from is already on the event via
-- advertiser_id; add the source for per-feed reporting in shared widgets.
alter table event add column if not exists source_id uuid;
