import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, parseCsv, parseXmlFeed, validateFeedUrl } from './dist/feed.js';

function streamOf(text, chunk = 64) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
      c.close();
    },
  });
}

async function parse(xml, mapping = null, itemTags) {
  const products = [];
  const result = await parseXmlFeed(streamOf(xml), mapping, async (p) => { products.push(p); }, itemTags);
  return { products, result };
}

test('price parsing handles Google and Danish formats', () => {
  // A wrong price on a Danish publisher page is a marketing-law problem, so
  // every one of these is a correctness case, not a nicety.
  assert.deepEqual(parsePrice('89.95 DKK'), { amount: '89.95', currency: 'DKK' });
  assert.deepEqual(parsePrice('89,95 DKK'), { amount: '89.95', currency: 'DKK' });
  assert.deepEqual(parsePrice('1.289,00 DKK'), { amount: '1289.00', currency: 'DKK' });
  assert.deepEqual(parsePrice('1,289.00 USD'), { amount: '1289.00', currency: 'USD' });
  assert.deepEqual(parsePrice('1.289 DKK'), { amount: '1289', currency: 'DKK' }); // not 1.29!
  assert.deepEqual(parsePrice('1 289,50 DKK'), { amount: '1289.50', currency: 'DKK' });
  assert.deepEqual(parsePrice('249 DKK'), { amount: '249', currency: 'DKK' });
  // Unparseable degrades to "no price" rather than an invalid numeric that
  // would abort the whole feed on insert.
  assert.deepEqual(parsePrice('kr. nul'), {});
  assert.deepEqual(parsePrice(''), {});
  assert.deepEqual(parsePrice(undefined), {});
});

test('nested elements do not overwrite canonical fields', async () => {
  // g:shipping/g:price must not become the product price.
  const xml = `<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel><item>
    <g:id>SKU-1</g:id><title>Barolo DOCG</title><link>https://shop.example/1</link>
    <g:shipping><g:country>DK</g:country><g:price>49.00 DKK</g:price></g:shipping>
    <g:price>289.00 DKK</g:price>
    <g:availability>in stock</g:availability>
  </item></channel></rss>`;
  const { products } = await parse(xml);
  assert.equal(products.length, 1);
  assert.equal(products[0].price_amount, '289.00');
});

test('nested price is ignored even when it appears after the real one', async () => {
  const xml = `<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel><item>
    <g:id>SKU-2</g:id><title>Chablis</title><link>https://shop.example/2</link>
    <g:price>149.00 DKK</g:price>
    <g:loyalty_program><g:price>99.00 DKK</g:price></g:loyalty_program>
  </item></channel></rss>`;
  const { products } = await parse(xml);
  assert.equal(products[0].price_amount, '149.00');
});

test('streams items across chunk boundaries and reports completeness', async () => {
  const items = Array.from({ length: 25 }, (_, i) =>
    `<item><g:id>S${i}</g:id><title>Produkt ${i}</title><link>https://x/${i}</link><g:price>10.00 DKK</g:price></item>`).join('');
  const xml = `<rss xmlns:g="http://base.google.com/ns/1.0"><channel>${items}</channel></rss>`;
  const { products, result } = await parse(xml, null, undefined);
  assert.equal(products.length, 25);
  assert.equal(result.count, 25);
  assert.equal(result.complete, true);
  assert.equal(result.hash.length, 64);
});

test('a truncated feed is reported as incomplete', async () => {
  // Non-strict SAX recovers silently, so without the completeness signal a
  // half-downloaded feed would look like a legitimate shrink and the
  // soft-delete would empty the catalogue.
  const xml = `<rss xmlns:g="http://base.google.com/ns/1.0"><channel>
    <item><g:id>A</g:id><title>A</title><link>https://x/a</link></item>
    <item><g:id>B</g:id><title>B</tit`;
  const { result } = await parse(xml);
  assert.equal(result.complete, false);
});

test('cdata, entities and multi-value fields survive', async () => {
  const xml = `<rss xmlns:g="http://base.google.com/ns/1.0"><channel><item>
    <g:id>SKU-3</g:id><title>R&#248;dvin &amp; ost</title><link>https://x/3</link>
    <g:product_type>Rødvin &gt; Veneto</g:product_type>
    <g:additional_image_link>https://x/a.jpg</g:additional_image_link>
    <g:additional_image_link>https://x/b.jpg</g:additional_image_link>
    <g:custom_label_1><![CDATA[Let rødvin — passer til svinekød]]></g:custom_label_1>
  </item></channel></rss>`;
  const { products } = await parse(xml);
  assert.equal(products[0].title, 'Rødvin & ost');
  assert.equal(products[0].product_type, 'Rødvin > Veneto');
  assert.deepEqual(products[0].additional_images, ['https://x/a.jpg', 'https://x/b.jpg']);
  assert.match(products[0].custom_label_1, /Let rødvin/);
});

test('items missing id, title or link are skipped, not half-imported', async () => {
  const xml = `<rss xmlns:g="http://base.google.com/ns/1.0"><channel>
    <item><title>ingen id</title><link>https://x/1</link></item>
    <item><g:id>OK</g:id><title>fin</title><link>https://x/2</link></item>
    <item><g:id>NOLINK</g:id><title>uden link</title></item>
  </channel></rss>`;
  const { products } = await parse(xml);
  assert.deepEqual(products.map((p) => p.external_id), ['OK']);
});

test('generic xml maps source elements and a custom item element', async () => {
  const xml = `<produkter><produkt><sku>A1</sku><navn>Hammer</navn><url>https://x/a1</url><pris>49,00 DKK</pris></produkt></produkter>`;
  const { products } = await parse(xml, { sku: 'id', navn: 'title', url: 'link', pris: 'price' }, ['produkt']);
  assert.equal(products.length, 1);
  assert.equal(products[0].external_id, 'A1');
  assert.equal(products[0].title, 'Hammer');
  assert.equal(products[0].price_amount, '49.00');
});

test('csv parsing handles quotes, embedded commas and escaped quotes', () => {
  const rows = parseCsv('id,title,link,price\n"A,2","Sav ""grov""",https://x/a2,29.00 DKK\n');
  assert.equal(rows[0].id[0], 'A,2');
  assert.equal(rows[0].title[0], 'Sav "grov"');
});

test('feed URLs are restricted to public http(s) endpoints', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(validateFeedUrl('https://files.channable.com/x.xml').ok, true);
    assert.equal(validateFeedUrl('http://169.254.169.254/latest/meta-data/').ok, false); // cloud metadata
    assert.equal(validateFeedUrl('file:///etc/passwd').ok, false);
    assert.equal(validateFeedUrl('http://10.0.0.5/f.xml').ok, false);
    assert.equal(validateFeedUrl('http://172.20.1.1/f.xml').ok, false);
    assert.equal(validateFeedUrl('http://192.168.1.1/f.xml').ok, false);
    assert.equal(validateFeedUrl('http://localhost/f.xml').ok, false);
    assert.equal(validateFeedUrl('nonsense').ok, false);
  } finally {
    process.env.NODE_ENV = prev;
  }
});
