// Every string the app shows a user (issue #102), grouped by screen.
//
// A component reads `copy.backup.save`, never "Save a backup". To change a
// word, change it here. A string with a run-time value is a function. A
// sentence with an inline element (an icon, a <code>, a <strong>) is split
// around the element into `before` and `after`.
//
// `npm test` fails when a prose string sits outside this file
// (scripts/ui-copy.ts). Site data is not copy and stays where it is: the
// category names in src/data/types.ts, the sea and landmark names in
// src/map/mapLabels.ts, and the tile and routing attributions.
//
// The test for a new string is in CLAUDE.md, under "UI copy": it earns its
// place only when the user needs it at that moment to act or to avoid a
// mistake.

export const copy = {
  units: {
    m: (n: number) => `${n} m`,
    km: (n: number | string) => `${n} km`,
    min: (n: number) => `${n} min`,
    h: (n: number) => `${n} h`,
    hMin: (h: number, m: number) => `${h} h ${m}`,
  },

  app: {
    tabs: { near: 'Nearby', filters: 'Filters', outing: 'Outing', stats: 'Saved' },
    loading: 'Loading sites…',
    loadFailed: {
      before: (error: string) => `Couldn't load site data: ${error}. Run`,
      command: 'npm run ingest',
      after: '.',
    },
    httpStatus: (status: number) => `HTTP ${status}`,
    expand: 'Expand panel',
    collapse: 'Collapse panel',
  },

  title: {
    name: 'Albion Adventure Land',
    sub: 'A field companion for Britain',
    begin: 'Tap the map to begin',
  },

  location: {
    unsupported: 'Geolocation not supported on this device.',
    denied: 'Location permission denied — drop a pin to set "I am here".',
    unavailable: 'Location unavailable — drop a pin to set "I am here".',
    lost: 'Location unavailable — drop a pin or search for a place.',
  },

  map: {
    layers: 'Map layers',
    north: 'N',
    basemaps: { street: 'Street', atlas: 'Atlas', satellite: 'Satellite' },
    zoomToMe: 'Zoom to my location',
    zoomToTap: 'Zoom in to tap a pin',
    manualLocation: 'Manual location',
    youAreHere: 'You are here',
  },

  journey: {
    picking: 'Tap the map…',
    locating: 'Locating…',
    droppedPin: 'Dropped pin',
    myLocation: 'My location',
    optional: 'Optional',
    direct: (distance: string) => `${distance} direct`,
    origin: 'Origin',
    originPickingTitle: 'Tap the map to set where you are, or tap here to cancel',
    originTitle: 'Search for somewhere to start from',
    backToMe: 'Back to my location',
    destination: 'Destination',
    changeDestination: (label: string) => `${label} — tap to change`,
    destinationPickingTitle: 'Tap the map to set your destination, or tap here to cancel',
    destinationTitle: 'Search for a destination',
    clearDestination: 'Clear destination',
    clearDestinationTitle: 'Clear destination (back to near-me)',
    detour: 'detour ≤',
    detourBudget: 'Detour budget',
    destinationHint: 'Tap where you\'re heading, or open a site and choose “Set as destination”.',
    originHint: 'Tap where you are, or where you\'ll be setting out from.',
  },

  route: {
    progress: (percent: number) => `${percent}% of the way`,
    onRoute: 'on the route',
    detour: (distance: string) => `+${distance} detour`,
  },

  search: {
    coordinates: 'Coordinates',
    sections: { coords: 'Coordinates', postcode: 'Postcode', site: 'Sites', place: 'Places' },
    postcodeNeedsSignal: 'Postcode lookup needs a signal in this build — try a town or place name instead.',
    postcodeOffline: 'That postcode isn’t in the offline set. Try its district (the first half) or a nearby town.',
    nothing: 'Nothing found.',
    nothingOffline: 'Nothing found — you’re offline, so only saved places are searchable.',
    dialog: 'Search for a place',
    startFrom: 'Start from',
    travelTo: 'Travel to',
    findOnMap: 'Find on the map',
    open: 'Search',
    close: 'Close search',
    placeholder: 'Town, site, postcode or grid ref',
    originField: 'Search for a place to start from',
    destinationField: 'Search for a destination',
    mapField: 'Search for a place or a site',
    clear: 'Clear',
    useMyLocation: 'Use my location',
    pickOnMap: 'Pick on the map',
    savedTitle: 'Saved from an earlier search',
    saved: 'saved',
    searching: 'Looking for more…',
    gridRef: (ref: string) => `Grid ref ${ref}`,
    gridRefDetail: (lat: string, lng: string) => `Grid reference · ${lat}, ${lng}`,
    postcodeDistrict: (outward: string) => `${outward} district (approximate)`,
    anyPostcodeDistrict: 'Postcode district',
    postcode: 'Postcode',
    city: 'City',
    town: 'Town',
    village: 'Village',
    placeDetail: (kind: string, region: string) => `${kind} · ${region}`,
  },

  near: {
    locating: 'Finding your location…',
    dropPin: { before: 'Use the', after: 'button on the map to drop a manual location.' },
    count: (n: number, manual: boolean) =>
      `${n} sites ${manual ? 'from your dropped pin' : 'near you'}, nearest first.`,
    onTheWay: (n: number, destination: string) =>
      `${n} ${n === 1 ? 'site' : 'sites'} on the way to ${destination}.`,
    travelOrder: 'Travel order',
    leastDetour: 'Least detour',
    noneInBudget: 'Nothing within this detour budget. Widen it in the bar above, or turn more layers on in Filters.',
    previousSite: (name: string) => `Previous site: ${name}`,
    noPrevious: 'No previous site',
    previous: '‹ Previous',
    nextSite: (name: string) => `Next site: ${name}`,
    noNext: 'No next site',
    next: 'Next ›',
    showMore: (n: number) => `Show ${n} more`,
    remaining: (n: number, route: boolean) => `(${n} ${route ? 'further along' : 'further away'})`,
  },

  strip: {
    region: 'Sites in view',
    fromCentre: 'Nearest the map centre first',
    fromYou: 'Nearest you first',
    fromPin: 'Nearest your pin first',
    fromPlace: (place: string) => `Nearest ${place} first`,
    alongTheWay: (destination: string) => `Along the way to ${destination}`,
    zoomIn: 'Zoom in to see the sites here',
    none: 'No sites here',
    noneOnTheWay: 'No sites within this detour',
  },

  finder: {
    close: 'Close site search',
    field: 'Find a site by name',
    none: 'No site by that name.',
    under: (name: string) => ` · under ${name}`,
  },

  filters: {
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    typesOn: (on: number, all: number) => `${on}/${all} types`,
    show: (layer: string) => `Show ${layer}`,
    tags: 'Tags',
    tagsSelected: (n: number) => ` · ${n} selected`,
    clear: 'Clear',
    fewerTags: 'Show fewer tags',
    allTags: (n: number) => `Show all ${n} tags`,
  },

  outing: {
    replaceConfirm: 'Replace your hand-picked trip with a found outing?',
    drive: (base: string, stops: number, withStops: string, extra: string) =>
      `Your drive is ${base}. With ${stops === 1 ? 'this stop' : `these ${stops} stops`}: ${withStops} (+${extra}).`,
    /** `start` is null with no location; `spread` is null for one stop. */
    summary: (
      stops: number,
      start: { distance: string; manual: boolean } | null,
      spread: string | null,
    ) =>
      (start
        ? `${stops} stops, starting ${start.distance} from ${start.manual ? 'your dropped pin' : 'you'}`
        : `${stops} stops`) +
      (spread ? `, spread over ${spread}` : '') +
      (start ? '.' : ' — drop a location to route them.'),
    clear: 'Clear',
    remove: (name: string) => `Remove ${name} from trip`,
    destination: 'Destination',
    openInMaps: 'Open route in Google Maps ↗',
    tooManyStops: 'Too many stops for one Google Maps link — open directions from each site\'s card instead.',
    empty: { before: 'Build a trip by tapping', action: '+ Add to trip', after: 'on any site — or let the app find one below.' },
    findForMe: 'Find one for me',
    pickOnTheWay: (destination: string) =>
      `Pick the kinds of day you want — one of each on your way to ${destination}, as a ready-made route.`,
    pickNearest: 'Pick the kinds of day you want — the nearest cluster with one of each, as a ready-made route.',
    matchMode: (layer: string) => `${layer} match mode`,
    oneOfEach: 'One of each',
    anyOfThese: 'Any of these',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    anyFolklore: 'One stop — any folklore sub-type.',
    anyOne: 'One stop of the selected type.',
    anySelected: (n: number) => `One stop — any of the ${n} selected.`,
    // "A or B" reads well for a small set. A longer set keeps the first two
    // and counts the rest, so the failure line stays short.
    anyOfSlot: (labels: string[]) =>
      labels.length <= 2
        ? labels.join(' or ')
        : `${labels[0]}, ${labels[1]} or ${labels.length - 2} more`,
    includeVisited: 'Include sites I\'ve already visited',
    find: 'Find outing',
    findAnother: 'Find another',
    noLocation: {
      before: 'No location yet — allow GPS or use the',
      after: 'button on the map to drop an "I am here" pin.',
    },
    pickAType: 'Select at least one type above.',
    noMore: 'No other qualifying cluster — this is the lot.',
    missingOnWay: 'Some of the selected types have nothing on your way:',
    missing: 'Some of the selected types have nothing to visit:',
    noneAtAll: 'none in the collection',
    noneUnvisited: 'none left unvisited',
    nearestIs: (detour: string) => `nearest is ${detour}`,
    tryWider: 'Try a wider detour budget in the bar above, dropping the type, or including visited sites.',
    tryDropping: 'Try dropping the type, or include visited sites.',
  },

  site: {
    close: 'Close',
    entry: (layer: string) => `${layer} entry`,
    via: 'Description via',
    viaCamra: 'CAMRA Heritage Pubs',
    viaUkc: 'UKClimbing',
    viaUnknown: 'source',
    enlarge: (caption: string) => `Enlarge: ${caption}`,
    enlargePicture: 'Enlarge picture',
    picture: (n: number) => `Picture ${n}`,
    away: (distance: string) => ` · ${distance} away`,
    visitedOn: (date: string) => `Visited ${date}`,
    wishlist: 'Wishlist',
    hidden: 'Hidden',
    partOf: 'Part of',
    walkIn: (time: string) => `Walk in: ${time}`,
    access: (access: string) => `Access: ${access}`,
    showMore: 'Show more ▾',
    showLess: 'Show less ▴',
    nearbyInListing: 'Nearby in this listing',
    directions: 'Directions ↗',
    showOnMap: 'Show on map',
    viewOnGoogle: 'View on Google Maps ↗',
    unmarkVisited: 'Unmark visited',
    markVisited: 'Mark visited',
    onWishlist: 'On wishlist',
    unhide: 'Unhide',
    hide: 'Hide',
    destination: 'Destination',
    setDestination: 'Set as destination',
    addToTrip: '+ Add to trip',
    alreadyEnd: 'Already the end of your trip',
    inTrip: 'In trip',
    needsLocation: 'Drop a location on the map to start a trip',
  },

  pubGrade: {
    label: 'CAMRA heritage',
    stars: (grade: number, max: number) => `${grade} of ${max} stars`,
  },

  hours: {
    days: {
      monday: 'Mon',
      tuesday: 'Tue',
      wednesday: 'Wed',
      thursday: 'Thu',
      friday: 'Fri',
      saturday: 'Sat',
      sunday: 'Sun',
    },
    closed: 'Closed',
    midnight: 'midnight',
    surveyed: 'Surveyed',
    updated: 'Updated',
    checked: 'Checked',
  },

  lightbox: {
    dialog: 'Picture viewer',
    close: 'Close viewer',
    previous: 'Previous picture',
    next: 'Next picture',
  },

  saved: {
    wishlist: (n: number) => `Wishlist (${n})`,
    noWishes: { before: 'No saved places yet. Tap', after: 'on a site to add it to your wishlist.' },
    visited: (n: number) => `Visited (${n})`,
    noVisits: 'No visits logged yet. Mark a site visited to start your log.',
    hidden: (n: number) => `Hidden (${n})`,
  },

  backup: {
    heading: 'Backup',
    save: 'Save a backup',
    copy: 'Copy as text',
    restoreFile: 'Restore from a file',
    paste: 'Paste a backup',
    cancelPaste: 'Cancel paste',
    pastePlaceholder: 'Paste the backup text here',
    restoreText: 'Restore from text',
    sent: 'Backup sent.',
    savedAs: (name: string) => `Saved as ${name}.`,
    saveFailed: 'Could not save a file. Copy the text below.',
    copied: 'Backup copied.',
    copyFailed: 'Could not copy. Copy the text below.',
    restored: (visits: number, wishlist: number, hidden: number) =>
      `Restored ${visits} ${visits === 1 ? 'visit' : 'visits'}, ${wishlist} wishlist, ${hidden} hidden.`,
    unreadable: 'That backup could not be read.',
    notJson: 'That doesn\'t look like a backup file — it isn\'t valid JSON.',
    notBackup: 'That doesn\'t look like a backup file.',
    wrongApp: 'That file is not an Albion Adventure Land backup.',
    tooNew: 'That backup was made by a newer version of the app. Update the app first.',
  },
} as const;
