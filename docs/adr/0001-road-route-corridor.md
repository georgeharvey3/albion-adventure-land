---
status: accepted
---

# A road route defines the journey corridor, and the ellipse is the offline fallback

Issue #29 asks for the park4night behavior: you give an origin and a
destination, the app finds the fastest road route, and "on the way" means a
small deviation from that route. Until now the corridor was a detour ellipse
built from great-circle distance alone (`src/geo/corridor.ts`). We keep both.
A resolved road route replaces the ellipse completely. With no route, the
ellipse is the answer, exactly as before.

## Why the ellipse cannot stay as a prefilter

The first plan was to keep the ellipse as a cheap prefilter and to re-score the
survivors against the route. This plan is wrong. A road route bends away from
the straight line between the two ends. A journey across the Highlands runs on
the A9 through Perth, and the straight line crosses Rannoch Moor. A site on the
A9 costs almost no extra driving, but it sits tens of kilometers off the
straight line. The ellipse drops that site before the route ever sees it. The
prefilter loses true results, so the two definitions must stay independent.

## How a site is measured against the route

The app snaps the site to the nearest point on the route polyline. The detour
is two times that distance, because you drive out to the site and back to the
road. This keeps the same unit as the ellipse, which is extra meters driven, so
the budget control in the journey bar means the same thing in both modes. The
snap point also gives the progress along the journey, as the distance along the
route divided by the total length.

The exact detour for one site is one more routing request for `origin → site →
destination`. One request for each of 1,200 sites is not possible, so the exact
detour is not the filter. It can become a per-site number on the site card
later.

## Which routing service

The app calls FOSSGIS OSRM at `https://routing.openstreetmap.de/routed-car`,
with `router.project-osrm.org` as the fallback. It needs no API key, so the
client has no secret to leak, and it sends `Access-Control-Allow-Origin: *`, so
the browser can call it direct. A 321 km route returns as 37 points with
`overview=simplified&geometries=polyline6`, which is small enough to cache for
each journey. The response gives both the distance and the duration.

The cost is a limit of one request per second, an attribution for
OpenStreetMap, and no promise of uptime. We accept all three. The app sends at
most one request for each journey, and a failed request falls back to the
ellipse.

Two services are rejected for legal reasons, not technical ones.
OpenRouteService forbids an API key in client-side code, and the only permitted
alternatives are a proxy server or a key for each user. This app has no
backend. Google Routes needs a billing account, forbids the display of its
results next to a non-Google map, and forbids the cache of its content. Leaflet
and offline-first make both of those clauses impossible to obey.

## Consequences

The resolved route is cached in IndexedDB, keyed by the two ends rounded to
three decimal places. The mental test in `CLAUDE.md` is that one online session
makes a region work in airplane mode. A route held only in memory fails that
test in the middle of the drive, which is the one place the app must work. This
cache also settles the open question in the spec about where the travel-time
matrix of Phase 4 lives.

The route is never a gate. Every failure path returns nothing, and the ellipse
answers instead. This is the same rule as the location search of issue #28: a
lost signal changes how many results appear, never whether the feature works.

The app shows no indicator for which of the two definitions is live. The map
draws the route as a line, with no shaded band, and the ellipse is not drawn
while a route is live. The journey bar reports the distance and the duration of
the route when there is one. The word "direct" appears only when the number is
a straight-line number.
