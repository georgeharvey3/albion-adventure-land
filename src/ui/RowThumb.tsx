import { useState } from 'react';
import { SITE_TYPE_COLORS, type Site } from '../data/types';

// Row thumbnail: the listing's first guidebook plate, or a flat tile in the
// category colour when there is no picture (only ~14% of sites have one, and a
// ragged left edge down a reading list is worse than a plain swatch). A picture
// that fails to load falls back to the same tile rather than a broken-image box.
export function RowThumb({ site }: { site: Site }) {
  const [broken, setBroken] = useState(false);
  const image = site.images?.[0];
  const tint = SITE_TYPE_COLORS[site.category];

  if (!image || broken) {
    return (
      <span
        className="row-thumb blank"
        style={{ background: tint }}
        aria-hidden="true"
      />
    );
  }
  return (
    <img
      className="row-thumb"
      src={`${import.meta.env.BASE_URL}${image.url}`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}
