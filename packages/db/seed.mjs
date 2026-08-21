// Seeds the V1 pilot skeleton: madensverden.dk × wine (spec §13/§14), wired to
// the built-in demo feed so the full loop (fetch → rules → serve → widget) is
// demoable end-to-end. Replace the feed's source_url with the advertiser's
// real Google Shopping feed to go live. Safe to run once on an empty schema.
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = neon(url);

// The Neon HTTP driver is stateless, so the target schema must come from the
// connecting role's default search_path (see setup-shared-db.sql). Guard
// against seeding into the wrong schema in a shared database.
const schemaName = process.env.DB_SCHEMA ?? 'stepcommerce';
const [{ schemas }] = await sql`select current_schemas(false) as schemas`;
if (schemas[0] !== schemaName) {
  console.error(
    `search_path resolves to [${schemas.join(', ')}] — expected "${schemaName}" first.\n` +
    `Connect as a role with "alter role ... set search_path = ${schemaName}" (see setup-shared-db.sql), ` +
    `or set DB_SCHEMA to override.`,
  );
  process.exit(1);
}

const DEMO_FEED_URL = process.env.DEMO_FEED_URL
  ?? 'https://stepcommerce.vercel.app/stepcommerce/api/demo-feed';

// Approved Template B design (madensverden.dk host-look, locked in the skill's
// prototype): warm paper surface, serif headings, bordeaux accents.
const RECIPE_TOKENS = {
  colorBackground: 'transparent',
  colorSurface: '#fffdf8',
  colorText: '#23211b',
  colorTextSecondary: '#8a8574',
  colorPrice: '#23211b',
  colorCtaBg: '#7a2f3a',
  colorCtaText: '#f7ecd9',
  colorBorder: '#eae5d6',
  colorAccent: '#7a2f3a',
  colorAccentSecondary: '#a4485a',
  colorBadgeBg: '#7a2f3a',
  colorBadgeText: '#f7ecd9',
  fontFamily: '"Segoe UI", system-ui, -apple-system, Arial, sans-serif',
  headingFontFamily: 'Georgia, "Times New Roman", serif',
  fontSizeBase: '15.5px',
  radius: '12px',
  shadow: '0 1px 2px rgba(60,55,40,.05)',
};

const INSTANCE_META = {
  sectionHeading: 'Vin til denne ret',
  matchLine: 'Udvalgt til opskriftens ingredienser:',
  bestMatchLabel: 'Bedste match',
  whyLabel: 'Hvorfor ser jeg denne?',
  whyText:
    'Anbefalingen er valgt ud fra opskriftens ingredienser — ikke ud fra dig. ' +
    'Vi bruger hverken cookies eller personlige oplysninger.',
};

const [adv] = await sql`
  insert into advertiser (name, company_info)
  values ('Pilot Vinhandel (demo)', '{"note": "pilot advertiser — replace with signed partner"}')
  returning id`;

const [feed] = await sql`
  insert into feed (advertiser_id, name, source_url, type)
  values (${adv.id}, 'Vin — demo-feed', ${DEMO_FEED_URL}, 'google_shopping_xml')
  returning id`;

const [site] = await sql`
  insert into site (publisher, domain, kv_taxonomy)
  values ('Madens Verden', 'madensverden.dk', ${JSON.stringify({
    keys: ['mv_cat', 'mv_ingredients', 'mv_keywords', 'mv_page', 'Domain', 'step_contextual', 'limited_ads'],
  })})
  returning id`;

// Per-site term dictionary (spec §14): page ingredient tokens → pairing segment.
const [dict] = await sql`
  insert into kv_dictionary (site_id, name, entries)
  values (${site.id}, 'Ingredienser → pairing-segment', ${JSON.stringify({
    skinkeschnitzler: 'svinekød', skinke: 'svinekød', flæsk: 'svinekød', nakkefilet: 'svinekød',
    svinemørbrad: 'svinekød', bacon: 'svinekød', frikadeller: 'svinekød',
    oksemørbrad: 'oksekød', 'hakket oksekød': 'oksekød', entrecote: 'oksekød', culotte: 'oksekød',
    oksesteg: 'oksekød', 'bøf': 'oksekød',
    kylling: 'fjerkræ', kyllingebryst: 'fjerkræ', kalkun: 'fjerkræ', and: 'fjerkræ',
    torsk: 'fisk', laks: 'fisk', rødspætte: 'fisk', rejer: 'fisk', muslinger: 'fisk',
    pasta: 'pasta', spaghetti: 'pasta', lasagne: 'pasta', risotto: 'pasta',
  })})
  returning id`;

const [tpl] = await sql`
  insert into widget_template (name, layout_type, design_tokens, slot_count)
  values ('Native recipe section', 'recipe_section', ${JSON.stringify(RECIPE_TOKENS)}, '{"default": 3}')
  returning id`;

const [inst] = await sql`
  insert into widget_instance (template_id, site_id, name, token_overrides, fallback_config, status)
  values (${tpl.id}, ${site.id}, 'Vin til opskrifter — madensverden.dk',
          ${JSON.stringify({ __meta: INSTANCE_META })},
          '{"strategy": "hide"}', 'live')
  returning id`;

await sql`
  insert into instance_advertiser (instance_id, advertiser_id, product_source, pricing_model, rate)
  values (${inst.id}, ${adv.id},
          ${JSON.stringify({ kind: 'full_feed', feed_id: feed.id })}, 'fixed', 3.50)`;

// One rule + one dict-mapping per pairing segment.
const SEGMENTS = ['svinekød', 'oksekød', 'fjerkræ', 'fisk', 'pasta'];
let priority = 0;
for (const segment of SEGMENTS) {
  const [rule] = await sql`
    insert into product_rule (feed_id, name, conditions)
    values (${feed.id}, ${`Pairing: ${segment}`}, ${JSON.stringify({
      all: [
        { field: 'custom_label_0', operator: 'equals', value: segment },
        { field: 'availability', operator: 'equals', value: 'in stock' },
      ],
    })})
    returning id`;
  await sql`
    insert into kv_mapping (instance_id, page_key, operator, dict_id, segment, target, priority)
    values (${inst.id}, 'mv_ingredients', 'dict', ${dict.id}, ${segment},
            ${JSON.stringify({ kind: 'rule', rule_id: rule.id })}, ${priority++})`;
}

await sql`
  insert into placement (site_id, name, code, rules, default_instance_id)
  values (${site.id}, 'Efter fremgangsmåde — artikel', 'PLC_mv_recipe',
          ${JSON.stringify([{ match: { key: 'mv_page', operator: 'eq', value: 'artikel' }, instance_id: inst.id }])},
          null)`;

console.log('Pilot seed done.');
console.log('  Placement: PLC_mv_recipe  Instance:', inst.id);
console.log('  Demo feed:', DEMO_FEED_URL, '— fetch it via /api/cron/fetch-feeds or the admin "Hent feed nu" button.');
