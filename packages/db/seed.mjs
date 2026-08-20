// Seeds the V1 pilot skeleton: madensverden.dk × wine merchant (spec §13/§14).
// The feed URL is a placeholder — point it at the advertiser's real Google
// Shopping feed before going live. Safe to run once on an empty schema.
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = neon(url);

const [adv] = await sql`
  insert into advertiser (name, company_info)
  values ('Pilot Vinhandel', '{"note": "pilot advertiser — replace with signed partner"}')
  returning id`;

const [feed] = await sql`
  insert into feed (advertiser_id, name, source_url, type)
  values (${adv.id}, 'Vin — Google Shopping', 'https://example.invalid/google-shopping.xml', 'google_shopping_xml')
  returning id`;

const [site] = await sql`
  insert into site (publisher, domain, kv_taxonomy)
  values ('Madens Verden', 'madensverden.dk', ${JSON.stringify({
    keys: ['mv_cat', 'mv_ingredients', 'mv_keywords', 'mv_page', 'Domain', 'step_contextual', 'limited_ads'],
  })})
  returning id`;

const [dict] = await sql`
  insert into kv_dictionary (site_id, name, entries)
  values (${site.id}, 'Ingredienser → pairing-segment', ${JSON.stringify({
    skinkeschnitzler: 'svinekød', skinke: 'svinekød', flæsk: 'svinekød', nakkefilet: 'svinekød',
    oksemørbrad: 'oksekød', hakket_oksekød: 'oksekød', entrecote: 'oksekød',
    kylling: 'fjerkræ', kalkun: 'fjerkræ', and: 'fjerkræ',
    torsk: 'fisk', laks: 'fisk', rødspætte: 'fisk',
    pasta: 'pasta', risotto: 'risotto',
  })})
  returning id`;

const [tpl] = await sql`
  insert into widget_template (name, layout_type, design_tokens, slot_count)
  values ('Native recipe section', 'recipe_section', '{}', '{"default": 3}')
  returning id`;

const [inst] = await sql`
  insert into widget_instance (template_id, site_id, name, fallback_config, status)
  values (${tpl.id}, ${site.id}, 'Vin til opskrifter — madensverden.dk',
          '{"strategy": "hide"}', 'draft')
  returning id`;

await sql`
  insert into instance_advertiser (instance_id, advertiser_id, product_source, pricing_model, rate)
  values (${inst.id}, ${adv.id},
          ${JSON.stringify({ kind: 'full_feed', feed_id: feed.id })}, 'fixed', 3.50)`;

const [rulePork] = await sql`
  insert into product_rule (feed_id, name, conditions)
  values (${feed.id}, 'Svinekød-pairing', ${JSON.stringify({
    all: [
      { field: 'custom_label_0', operator: 'contains', value: 'svinekød' },
      { field: 'availability', operator: 'equals', value: 'in stock' },
    ],
  })})
  returning id`;

await sql`
  insert into kv_mapping (instance_id, page_key, operator, dict_id, segment, target, priority)
  values (${inst.id}, 'mv_ingredients', 'dict', ${dict.id}, 'svinekød',
          ${JSON.stringify({ kind: 'rule', rule_id: rulePork.id })}, 0)`;

await sql`
  insert into placement (site_id, name, code, rules, default_instance_id)
  values (${site.id}, 'Efter fremgangsmåde — artikel', 'PLC_mv_recipe',
          ${JSON.stringify([{ match: { key: 'mv_page', operator: 'eq', value: 'artikel' }, instance_id: inst.id }])},
          null)`;

console.log('Pilot seed done: placement PLC_mv_recipe →', inst.id);
