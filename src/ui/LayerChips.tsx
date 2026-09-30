import { useMemo } from 'react';
import { useStore } from '../state/store';
import { layerState, siteLayers } from '../state/layers';
import { PARENT_CATEGORY_COLORS, PARENT_CATEGORY_LABELS } from '../data/types';
import { copy } from '../copy';

/** One chip per layer: the quick form of the switch at the head of each layer
 *  in Filters. The desktop card wraps the chips, and the phone's floating row
 *  scrolls them sideways (issue #109). The count is the layer's, as in the
 *  Filters header. */
export function LayerChips({ className }: { className: string }) {
  const sites = useStore((s) => s.sites);
  const activeTypes = useStore((s) => s.activeTypes);
  const setTypesActive = useStore((s) => s.setTypesActive);
  const layers = useMemo(() => siteLayers(sites), [sites]);
  return (
    <div className={`layer-chips ${className}`}>
      {layers.map(({ parent, leaves, count }) => {
        const state = layerState(leaves, activeTypes);
        return (
          <button
            key={parent}
            className={`chip ${state}`}
            onClick={() => setTypesActive(leaves, state !== 'on')}
            aria-pressed={state === 'on'}
            aria-label={copy.filters.show(PARENT_CATEGORY_LABELS[parent])}
          >
            <span className="dot" style={{ background: PARENT_CATEGORY_COLORS[parent] }} />
            {PARENT_CATEGORY_LABELS[parent]}
            <span className="chip-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
