# Albion Adventure Land

A visiting companion for curated locations across Britain. This file is the
glossary: one name for each thing, and the names to avoid. It holds no
implementation detail — the design system lives in `design.md`, the working
rules in `CLAUDE.md`, and the product spec in `plans/britain-sites-app-spec.md`.

## Language

### The data

**Site**:
One visitable location with a name and coordinates. The unit the user visits,
saves and searches.
_Avoid_: pin, location, spot, POI

**Listing**:
A main site together with the subordinate points that belong to it — its
trailhead, its parking, a nearby feature. A listing is a grouping of sites, not
a site.
_Avoid_: group, cluster, entry

**Site type**:
The leaf of the controlled two-level vocabulary a site belongs to (stone
circles, wild swims, historic pubs). The level above it is the **parent
category**.
_Avoid_: kind, tag, class

**Findable as**:
The set of leaf categories a filter matches a site under. It is the site's own
type, plus the type of each row merged into it as a cross-source duplicate. Read
it with `categoriesOf`. A site still has one type: the one on its pin and its
card.
_Avoid_: multi-category, secondary type

### The journey

**Origin**:
The end of the journey you are travelling from. Defaults to the live position,
and can also be a dropped pin or a searched place.
_Avoid_: start, from, here, anchor

**Destination**:
The end of the journey you are travelling to. Optional — without one the app
answers "what is near me", with one it answers "what is on my way".
_Avoid_: finish, to, target

**Journey search**:
The search opened from either journey end. It fills that end, and it answers
from places, postcodes, coordinates, grid references and sites.
_Avoid_: location search, place search

**Route**:
The road line from the origin to the destination, resolved online from a
routing service. Optional: without one the journey falls back to the direct
origin-to-destination line.
_Avoid_: directions, path, itinerary, road route

**Corridor**:
The set of sites the journey can afford — everything inside the detour budget.
It is measured against the route when there is one, and against the direct line
when there is not.
_Avoid_: band, catchment, buffer

**Detour**:
The extra travel a site costs against the journey.

**Trip**:
The ordered set of stops for one day out. The user builds it by hand, one site
at a time, or the finder builds it from a choice of site types. With a
destination, the stops sit between the two ends of the journey. There is one
trip at a time. A trip is the stops; the journey is the two ends. "My trip to
Winchester" names both: a journey to Winchester, and the stops on the way.
_Avoid_: outing, itinerary, route, plan

**Progress**:
How far along the journey a site sits, from the origin at 0 to the destination
at 1.

### Finding and seeing

**Site finder**:
The search that answers "which of my sites is that" by name. It selects the site
it finds; it never sets a journey end.
_Avoid_: site search, lookup, filter box

**Selection**:
The one site the app is currently showing in detail — as a card over the map, or
as the expanded row in browse mode. There is exactly one.
_Avoid_: active site, focus, current site

**Browse mode**:
Reading the nearby list with the map hidden and the list given the whole screen.
_Avoid_: list mode, reader

**Filter**:
An ambient, category-level choice about which site types are on show. Applies to
every site of that type at once.
_Avoid_: toggle, category filter

**Hide**:
A per-site decision that this site is not wanted at all. Distinct from a filter:
a filter is about a type and is expected to change often, hiding is about one
site and is expected to last.
_Avoid_: block, ignore, dismiss

**Reveal**:
Turning a filtered-off site type back on because the user asked for one of its
sites by name.

### Asking Ethelred

**Ethelred**:
The travel agent. It answers questions asked in plain language from the site
data, the places the app knows and the road routes it can find. It names only
sites that exist in the data, and it states only facts that the data holds. It
needs a signal; the rest of the app does not.
_Avoid_: assistant, chatbot, AI, the agent

**Answer**:
What Ethelred gives back to one question: prose, plus the sites it names. An
answer shows its sites on the map as its own set, apart from the filter.
_Avoid_: response, result, reply

**Conversation**:
The questions and answers that follow on from one another, so that "the second
one" means something. The device keeps the latest conversation until the user
starts a new one. It is disposable: it is not user state and it is not in the
backup.
_Avoid_: chat, session, thread

**Report**:
One conversation that a user chose to send back because an answer was wrong.
It is the only conversation that ever leaves the device to be kept.
_Avoid_: feedback, flag, complaint

**Hand-off**:
An action an answer offers and the user must tap before anything changes — use
as journey, add to trip, plan a trip, show on map. Ethelred proposes; the user decides.
_Avoid_: suggestion, command, apply

## Open terms

**Route (overloaded)** — the glossary now gives `route` to the road line of the
journey, but the code also uses it for the order of the trip stops
(`orderRoute` in `src/geo/tsp.ts`, `routeSort` in the store). These are two
different things. The trip sense needs a new name; not yet resolved.
