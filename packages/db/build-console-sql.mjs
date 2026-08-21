// Generates console-setup.sql — a single file to paste into the Neon SQL
// editor when no programmatic write access is available. It performs the
// full bootstrap: schema + app role + grants + all tables + pilot seed.
// Regenerate after changing schema.sql: npm run console-sql -w @stepcommerce/db
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, 'schema.sql'), 'utf8');

const out = `-- ============================================================================
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
${schema.replace(/^create extension if not exists pgcrypto;\n/m, '')}

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
    "fontFamily": "\\"Segoe UI\\", system-ui, -apple-system, Arial, sans-serif",
    "headingFontFamily": "Georgia, \\"Times New Roman\\", serif",
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
`;

writeFileSync(join(here, 'console-setup.sql'), out);
console.log('Wrote console-setup.sql');
