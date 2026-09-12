# Wild Things Publishing — collaboration analysis

*Written September 2026. A read on WTP's digital strategy, where Albion
Adventure Land fits, and what to build before approaching them.*

---

## 1. What they have built digitally

| | |
|---|---|
| Catalogue | ~24 *Wild Guide* titles, plus the *Wild Swimming* series, *Wild Ruins*, *Magical Britain* / *Magical France*, *Hidden Beaches*, *Lost Lanes*, *Bikepacking*, *Snorkelling Britain*, *Wild Swimming Walks* — 40+ location-led titles |
| Apps | First app 2012 (*Wild Swimming*); six titles in 2015 on iOS + Android; a new batch in April 2023 with older ones updated |
| Shape | **One app per title/region.** Android package ids (`to.apn.wild.guide.sw`, `to.apn.wild.swimming`) show a shared white-label platform, not bespoke builds |
| App features | Full book text + photography; map / list / gallery / slideshow views; search by place, postcode and "near me"; filters by keyword, feature, chapter, walk-in time, star rating; favourites; share; directions; offline mapping on UK titles (1:250k road atlas + 1:25k OS district with OSM footpaths overlaid); some international titles link out to IGN and need a connection |
| Other digital SKUs | PDF / ebook per title, chaptered downloads, **satnav POI files**, interactive coordinate links |
| Cartography | Produced with Lovell Johns |

The strategy in one line: **the book is the product, and digital is another
format of the book.** An app is a container for one title; revenue is a one-off
purchase per title, mirroring print. For a small independent publisher that is a
sound, low-risk approach, and it is why it has lasted fourteen years.

It also has four structural limits, none of which can be fixed inside the
one-app-per-book model.

## 2. The four structural limits

1. **The map is cut along commercial lines, not along how people travel.** A
   reader standing in Grasmere who owns four relevant guides has four apps and
   four maps to check, each showing a quarter of what is around them.

2. **The catalogue cannot sell itself in the field.** The best advertisement for
   *Wild Ruins* is a ruin pin two kilometres from the swim you are already
   driving to. One app per title makes that impossible, so every cross-sell has
   to be paid for through marketing instead of falling out of the product.

3. **No retention loop.** Favourites is a bookmark, not a collection. There is no
   visited state, no completion, no record of the day. So there is no reason to
   reopen the app after the trip, no recurring revenue — and, the part a
   publisher should care about most, **no data on which places readers actually
   visit**, which is exactly what should inform the next edition.

4. **Cost scales with the number of titles.** 40+ titles × 2 platforms means
   every content change is a release cycle. The 2015 → 2023 gap is what that
   cost looks like in practice. A data-driven base app inverts it: a new guide
   becomes a data pack, not a build.

One asset they already hold makes the modular approach cheap: they sell **satnav
POI files per guide**, so structured location data per title already exists.
That is the ingest input, already in their hands.

## 3. What this app already is

2,854 sites, six independent sources (four of them WTP titles), one map,
offline-first. It already does the things a fragmented estate structurally
cannot:

- one map, every guide, one filter system (two-level taxonomy plus per-source
  verbatim tags);
- per-source ingest mappings — a new guide is a CSV and one config file, no code;
- near-me, visited / wishlist, completion stats with rarity weighting;
- **outing mode** — "one historic pub, one holy well, one wild swim: find the
  nearest place where that whole day exists", routed and handed to Google Maps;
- **journey mode** — "I'm driving A → B, what's worth stopping for within X km of
  extra driving", using a detour ellipse rather than a radius;
- offline-first throughout: the field loop works in airplane mode.

The expensive, differentiated part — the engine — is built. What is missing is
the part that makes it *their business* rather than a good map app.

## 4. Highest-value features to build before pitching

Ranked by (demonstrates something their architecture structurally cannot do) ×
(cost to build).

### Tier 1 — these *are* the pitch

**1. Guide packs as a first-class concept.** The single highest-value change.
Promote `source` from an ingest detail to a product object: id, title, cover,
coverage area, site count, price, owned / locked. The map of Britain then
visibly fills in as packs are added — one app, N SKUs, their commercial model
expressed in software. This is what turns a demo into a proposal.

**2. Locked-pack teasers — the cross-sell engine.** Sites from packs the user
does not own render as ghost pins with the name withheld: *"A wild swim from
Wild Guide Lakes & Dales, 1.2 km away — unlock."* Near-me and outing results
say *"3 more nearby in guides you don't own."* This is a revenue mechanic they
can model in a spreadsheet before they ever meet you, and it is impossible in
their current estate. Pair it with a redeem-code entitlement stub in IndexedDB
so the unlock flow is real end to end.

**3. Download a region / pack for offline.** Their UK apps already ship offline
1:250k and 1:25k OS mapping; this app currently caches only what you happened to
browse. Until *"download the Lakes"* is one button (tiles, images and data for a
bounding box), the demo loses on the one dimension where they already win. Table
stakes for credibility, not a differentiator.

### Tier 2 — the retention story

**4. The collection: per-guide completion, visit log, export.** Phase 3 of the
spec, reframed commercially: *"Wild Swimming Britain — 34 of 400 swum"*, with a
note, photo and date per visit. This is the argument that a one-off £6 purchase
can become an account worth keeping, and the anonymised aggregate is visit data
for the next edition — a pitch a publisher understands immediately.

**5. Parity features that cost little and kill the "less capable than ours"
objection.** Star rating, walk-in-time filter (`walkTime` is already carried),
condition filters (tide / seasonal / paid), and place-or-postcode search. Search
needs a small offline gazetteer of GB places — a few thousand entries, tiny —
and it is worth it, because postcode search is in every one of their apps and its
absence reads as a gap rather than a design decision.

### Tier 3 — the operational argument, which may matter most to whoever signs

**6. A ten-minute "new guide goes live" demo.** Take one of their existing satnav
POI exports, write a mapping file, run ingest, show the pins live. Their marginal
cost per title today is an app release; here it is a config file. Record it —
that is more persuasive than any feature.

**7. A prepared answer on store presence.** Their distribution is the App Store
and Play; a PWA has no shopfront. Have the answer ready before it is asked: the
same codebase wrapped (Capacitor) for store listings and in-app purchase, PWA on
the web. Do not let *"it's a website"* be the objection that ends the meeting.

### What not to build

Turn-by-turn navigation (delegate it), social or user-generated content, a CMS,
or anything that needs a backend to work in the field. All expensive, none of
them the reason they would say yes.

## 5. How to frame the approach

- **Lead with their problem in their language:** a reader with four of your
  guides has four apps and four maps, and none of them says what else of yours is
  within five miles.
- **Show three things, in this order:** the whole-catalogue map; the locked-pack
  cross-sell; then outing and journey mode, which nothing in the outdoor-guide
  market does.
- **Ask for a small first step:** a licence to build one region as a pilot — the
  South West, where swims, ruins, folklore and pubs already overlap — not
  "replace your app estate".
- **Be explicit about the commercial shape:** per-pack revenue share, or a build
  fee plus maintenance. Their alternative is a white-label bill per title,
  forever.

## 6. Two things to handle first

**Copyright.** This build is populated with text and photographs extracted from
their books. That is their copyright. It is fine as a private prototype shown to
them — it is arguably the strongest possible proof that their catalogue can be
ingested — but keep the deployment private, say plainly in the first email that
it is built on their content as a demonstration and that data would be licensed
or rebuilt, and keep their photography out of anything public. Getting ahead of
this is the difference between "interesting" and "legal problem".

**Verify before pitching.** Current app prices, whether any bundle or
multi-title app exists, and the live app-store ratings could not be checked
while writing this (app-store domains were unreachable). The "one app per title"
observation is the spine of the argument, so confirm it holds today.
