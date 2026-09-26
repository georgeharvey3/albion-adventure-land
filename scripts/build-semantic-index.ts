// Build the semantic index for Ethelred (issue #62) from public/data/sites.json.
// Run it after `npm run ingest`. The server also rebuilds a stale index when it
// starts, so this step is for a warm start, not a requirement.

import { buildIndex } from '../server/boot';
import { loadSiteData } from '../server/data';

buildIndex(loadSiteData()).catch((err) => {
  console.error(err);
  process.exit(1);
});
