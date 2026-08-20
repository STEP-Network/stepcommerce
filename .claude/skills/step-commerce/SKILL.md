---
name: step-commerce
description: >-
  STEP Commerce — STEP Networks kontekstuelle commerce-widget-platform: produktfeeds ind,
  frit stylede widgets ud via JavaScript/GAM, matchet til sidens indhold via key-values,
  målt first-party og solgt på CPC/affiliate/exclusive. ALWAYS use this skill when Ulrik
  arbejder på STEP Commerce i enhver form: videreudvikling af repoet (widget-runtime,
  feed-fetcher, /api/serve, admin, schema), nye widget-templates eller publisher-cases
  (fx "lav en widget til [site]", "native widget", "vin-widget", "tilbudsavis-widget"),
  opdatering af spec/businessplan, salgsmateriale eller pitch til annoncører/publishers
  om widgets, samt spørgsmål om produktets model, roadmap eller beslutninger — også ved
  casual phrasings som "commerce-projektet", "widget-platformen", "vores widgets".
  Indeholder fuld spec, produktresumé med beslutningslog, salgsnarrativ, godkendte
  prototyper og case-screenshots.
---

# STEP Commerce — produktskill

Alt hvad en session skal vide for at arbejde på STEP Commerce uden genopfriskning.

## Læs først (efter opgavetype)
- **Kode/repo-arbejde:** `references/product-summary.md` (beslutningslog + repo-status) → derefter relevante §§ i `references/spec.md`. Repoet round-trippes som zip; bed om nyeste zip hvis den ikke er uploadet. Respektér CLAUDE.md i repoet — især V1-grænsen.
- **Nyt widget-design/publisher-case:** `references/product-summary.md` (templates + beslutning 8/10) + åbn de to prototyper i `assets/` som designreference. Nye cases bygges som selvstændige HTML-prototyper i host-sitets look med prototype-kontrolbjælke (mønstret fra assets).
- **Salgsmateriale/pitch:** `references/sales-narrative.md` + `stepnetwork-brand`-skillen (obligatorisk for al styling).
- **Spec/strategi-ændringer:** `references/spec.md` er kilden til sandhed — opdatér den OG bed Ulrik gemme den nye version, og afspejl større beslutninger i product-summary'ens beslutningslog.

## Ufravigelige produktregler (resumé — detaljer i spec)
1. CPC er kerneproduktet, affiliate er backfill, exclusive er premium. 
2. To kontekst-niveauer: placement-regler vælger widget; instans-mappings vælger produkter. KV-match: `eq`/`contains`/`dict`.
3. 100 % kontekstuelt — ingen cookies/user-IDs/TCF-gate; `limited_ads` respekteres.
4. GAM-kreativ får KVs via %%PATTERN%% — aldrig googletag fra SafeFrame.
5. Widget: vanilla TS, Shadow DOM, 0 deps, ≤30 KB gzip, fail silent, tokens styrer al styling.
6. Stale feed-data (>24 t) renderes aldrig; fallback-kæde: match → default → intet.
7. Produktionsassets fra annoncørens feed/aftale — aldrig scraped.
8. Ingen opdigtede tal i noget materiale.

## Filer
```
step-commerce/
├── SKILL.md
├── references/
│   ├── spec.md                ← fuld build-spec (§1–15) — kilden til sandhed
│   ├── product-summary.md     ← resumé, roadmap, beslutningslog, repo-status
│   └── sales-narrative.md     ← kernebudskaber, deck-struktur, tone, målgrupper
└── assets/
    ├── prototype-template-a-forum.html    ← godkendt design: native forumindlæg (HN × lds.dk)
    ├── prototype-template-b-recipe.html   ← godkendt design: native opskrift-sektion (vin × madensverden)
    ├── case-hn-forum.png                  ← screenshot til decks/dokumenter
    └── case-mv-vin.png                    ← screenshot til decks/dokumenter
```

## Vedligehold
Når en session ændrer produktet væsentligt (ny beslutning, nyt template, roadmap-skift, repo-milepæl): opdatér `product-summary.md` (beslutningslog + repo-status) før sessionen slutter. Skillen er kun værdifuld, hvis den følger med virkeligheden.
