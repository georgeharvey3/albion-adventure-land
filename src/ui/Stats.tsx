import { useStore } from '../state/store';
import {
  SITE_TYPES,
  SITE_TYPE_COLORS,
  SITE_TYPE_LABELS,
  type SiteCategory,
} from '../data/types';

// Completion stats (spec §6 F6): the finish line that turns a viewer into a
// collection. Overall + per-type + per-county visited counts, and the
// "rarest type you haven't seen" nudge — the first consumer of the rarity
// index built at load (spec §7.4).

export function Stats() {
  const sites = useStore((s) => s.sites);
  const visited = useStore((s) => s.visited);
  const rarity = useStore((s) => s.rarity);

  const total = sites.length;
  let totalVisited = 0;
  const byType = new Map<SiteCategory, { total: number; visited: number }>();
  const byCounty = new Map<string, { total: number; visited: number }>();

  for (const site of sites) {
    const isVisited = site.id in visited;
    if (isVisited) totalVisited++;

    const t = byType.get(site.category) ?? { total: 0, visited: 0 };
    t.total++;
    if (isVisited) t.visited++;
    byType.set(site.category, t);

    const countyKey = site.county ?? 'Unspecified';
    const c = byCounty.get(countyKey) ?? { total: 0, visited: 0 };
    c.total++;
    if (isVisited) c.visited++;
    byCounty.set(countyKey, c);
  }

  // The nudge: rarest type with no visits at all; if every type has been seen
  // at least once, fall back to the rarest type with sites still left.
  let nudge: { type: SiteCategory; unseen: boolean } | null = null;
  if (rarity) {
    const pick = (pred: (c: { total: number; visited: number }) => boolean) => {
      let best: SiteCategory | null = null;
      for (const [type, c] of byType) {
        if (!pred(c)) continue;
        if (best === null || rarity.rarity[type] > rarity.rarity[best]) best = type;
      }
      return best;
    };
    const unseen = pick((c) => c.visited === 0);
    if (unseen) nudge = { type: unseen, unseen: true };
    else {
      const remaining = pick((c) => c.visited < c.total);
      if (remaining) nudge = { type: remaining, unseen: false };
    }
  }

  const typeRows = SITE_TYPES.filter((t) => byType.has(t));
  const countyRows = [...byCounty.entries()].sort((a, b) => b[1].total - a[1].total);
  const pct = total ? Math.round((totalVisited / total) * 100) : 0;

  return (
    <div className="stats">
      <div className="stats-total">
        <span className="stats-big">
          {totalVisited} / {total}
        </span>
        <span className="stats-pct">{pct}% visited</span>
        <div className="stats-bar">
          <div className="stats-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {nudge && (
        <p className="stats-nudge">
          {nudge.unseen ? (
            <>
              🔍 Rarest type you haven't seen:{' '}
              <strong>{SITE_TYPE_LABELS[nudge.type]}</strong> — only{' '}
              {byType.get(nudge.type)!.total} in the whole collection.
            </>
          ) : (
            <>
              🔍 Rarest type with sites left:{' '}
              <strong>{SITE_TYPE_LABELS[nudge.type]}</strong> (
              {byType.get(nudge.type)!.total - byType.get(nudge.type)!.visited} to go).
            </>
          )}
        </p>
      )}
      {total > 0 && totalVisited === total && (
        <p className="stats-nudge">🏆 Collection complete. Time for a new CSV.</p>
      )}

      <h3 className="stats-heading">By type</h3>
      <ul className="stats-list">
        {typeRows.map((type) => {
          const c = byType.get(type)!;
          return (
            <li key={type} className="stats-row">
              <span className="dot" style={{ background: SITE_TYPE_COLORS[type] }} />
              <span className="stats-label">{SITE_TYPE_LABELS[type]}</span>
              <span className="stats-count">
                {c.visited} / {c.total}
              </span>
            </li>
          );
        })}
      </ul>

      <h3 className="stats-heading">By area</h3>
      <ul className="stats-list">
        {countyRows.map(([county, c]) => (
          <li key={county} className="stats-row">
            <span className="stats-label">{county}</span>
            <span className="stats-count">
              {c.visited} / {c.total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
