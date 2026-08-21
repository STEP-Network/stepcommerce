-- 002: serve-decision telemetry, feed fetch log, feed content-hash tracking,
-- nullable click.instance_id.
--
-- Safe to run against a database created from the pre-002 baseline; every
-- statement is idempotent so a partially applied migration can be re-run.

alter table feed add column if not exists content_changed_at timestamptz;
alter table feed add column if not exists item_element text;

alter table click alter column instance_id drop not null;

create table if not exists serve_decision (
  hour         timestamptz not null,
  placement_id uuid not null,
  reason       text not null,
  count        bigint not null default 0,
  primary key (hour, placement_id, reason)
);

create table if not exists feed_fetch_log (
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
create index if not exists feed_fetch_log_idx on feed_fetch_log (feed_id, ts desc);

-- Serve path: the full_feed source orders by relevance then recency, which the
-- soft-delete-aware partial index cannot serve on a large feed.
create index if not exists product_feed_updated_idx on product (feed_id, updated_at desc) where available;
create index if not exists product_feed_seen_idx on product (feed_id, last_seen_at) where available;
