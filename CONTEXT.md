# Albion Adventure Land

A visiting companion for curated locations across Britain. This file is the
glossary: one name for each thing, and the names to avoid. It holds no
implementation detail — the design system lives in `design.md`, the working
rules in `CLAUDE.md`, and the product spec in `britain-sites-app-spec.md`.

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

**Rarity**:
How uncommon a site's type is across the whole dataset. Derived at load time,
never stored.

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

**Detour**:
The extra travel a site costs against the direct origin-to-destination line.

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

## Open terms

**Outing / trip** — the code says `outing` (store, tab, finder) and the site card
says "+ Add to trip". One of these has to go; not yet resolved.
