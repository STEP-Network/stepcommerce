// Demo Google Shopping feed for the pilot skeleton — lets the full loop
// (feed fetch → products → rules → serve → widget) run end-to-end before a
// real advertiser feed is connected. All products are clearly marked DEMO and
// link to stepnetwork.dk. Replace the pilot feed's source_url with the real
// advertiser feed to go live (spec rule: production assets come from the
// advertiser's feed/agreement).
//
// Field conventions used by Template B (native recipe section):
//   custom_label_0 = pairing segment (svinekød | oksekød | fjerkræ | fisk | pasta)
//   custom_label_1 = one-line "derfor" pairing explanation
//   custom_label_2 = match score 0–100
import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

interface DemoWine {
  id: string; title: string; type: string; price: string; sale?: string;
  pairing: string; reason: string; score: number;
}

const WINES: DemoWine[] = [
  { id: 'DEMO-VALPO', title: 'Valpolicella Classico (DEMO)', type: 'Rødvin > Veneto, Italien', price: '119.00', sale: '89.00', pairing: 'svinekød', reason: 'Let rødvin med kirsebærfrugt — trykker ikke det fine svinekød flad.', score: 96 },
  { id: 'DEMO-PINOT', title: 'Pinot Noir Réserve (DEMO)', type: 'Rødvin > Bourgogne, Frankrig', price: '129.00', pairing: 'svinekød', reason: 'Klassikeren til skinke og rosmarin — silkeblød med saftig syre.', score: 98 },
  { id: 'DEMO-RIESLING', title: 'Riesling Trocken (DEMO)', type: 'Hvidvin > Mosel, Tyskland', price: '99.00', pairing: 'svinekød', reason: 'Til dig, der vil have hvid: sprød syre, der løfter den salte skinke.', score: 93 },
  { id: 'DEMO-BAROLO', title: 'Barolo DOCG (DEMO)', type: 'Rødvin > Piemonte, Italien', price: '249.00', pairing: 'oksekød', reason: 'Tanninerne vil have fedt og kraft — perfekt til oksekød.', score: 97 },
  { id: 'DEMO-MALBEC', title: 'Malbec Reserva (DEMO)', type: 'Rødvin > Mendoza, Argentina', price: '109.00', sale: '79.00', pairing: 'oksekød', reason: 'Mørk frugt og blød struktur til stegt og grillet oksekød.', score: 94 },
  { id: 'DEMO-CHABLIS', title: 'Chablis (DEMO)', type: 'Hvidvin > Bourgogne, Frankrig', price: '149.00', pairing: 'fisk', reason: 'Mineralsk og stram — klassikeren til fisk og skaldyr.', score: 96 },
  { id: 'DEMO-SANCERRE', title: 'Sancerre Blanc (DEMO)', type: 'Hvidvin > Loire, Frankrig', price: '139.00', pairing: 'fisk', reason: 'Frisk syre og urter, der løfter stegt hvid fisk.', score: 92 },
  { id: 'DEMO-BOURGOGNE', title: 'Bourgogne Rouge (DEMO)', type: 'Rødvin > Bourgogne, Frankrig', price: '119.00', pairing: 'fjerkræ', reason: 'Let og saftig pinot — flatterer kylling og kalkun.', score: 95 },
  { id: 'DEMO-CHIANTI', title: 'Chianti Classico (DEMO)', type: 'Rødvin > Toscana, Italien', price: '99.00', sale: '85.00', pairing: 'pasta', reason: 'Syrlig kirsebærfrugt, der matcher tomat og pasta.', score: 94 },
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function GET(): NextResponse {
  const items = WINES.map((w) => `  <item>
    <g:id>${w.id}</g:id>
    <title>${esc(w.title)}</title>
    <link>https://stepnetwork.dk/?utm_source=stepcommerce_demo&amp;utm_content=${w.id}</link>
    <g:price>${w.price} DKK</g:price>${w.sale ? `\n    <g:sale_price>${w.sale} DKK</g:sale_price>` : ''}
    <g:availability>in stock</g:availability>
    <g:brand>STEP Demo Vinhandel</g:brand>
    <g:product_type>${esc(w.type)}</g:product_type>
    <g:custom_label_0>${esc(w.pairing)}</g:custom_label_0>
    <g:custom_label_1>${esc(w.reason)}</g:custom_label_1>
    <g:custom_label_2>${w.score}</g:custom_label_2>
  </item>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>STEP Commerce demo-feed (vin)</title>
  <description>Synthetic demo products — replace with the advertiser's real feed before launch.</description>
  <link>https://stepnetwork.dk/stepcommerce</link>
${items}
</channel>
</rss>`;
  return new NextResponse(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
