import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

// PROTOTYPE — throwaway variant switcher (issue #74). Reads and writes
// `?variant=` so a variant is shareable and survives a reload. Dev builds only.

const EVENT = 'prototype-variant';

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useVariant<K extends string>(keys: readonly K[], fallback: K): K {
  const raw = useSyncExternalStore(subscribe, () => new URLSearchParams(location.search).get('variant'));
  if (!import.meta.env.DEV) return keys[0];
  return keys.includes(raw as K) ? (raw as K) : fallback;
}

function setVariant(key: string) {
  const url = new URL(location.href);
  url.searchParams.set('variant', key);
  history.replaceState(history.state, '', url);
  window.dispatchEvent(new Event(EVENT));
}

export function PrototypeSwitcher({
  variants,
  current,
  readout,
}: {
  variants: { key: string; name: string }[];
  current: string;
  readout?: string;
}) {
  const i = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (step: number) => setVariant(variants[(i + step + variants.length) % variants.length].key);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Capture, so Leaflet's keyboard panning doesn't eat the arrows first.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!import.meta.env.DEV) return null;
  const v = variants[i];
  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: '50%',
        top: 12,
        transform: 'translateX(-50%)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 999,
        background: '#111',
        color: '#fff',
        font: '600 13px/1.2 system-ui, sans-serif',
        boxShadow: '0 4px 16px rgba(0,0,0,.35)',
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <button type="button" onClick={() => go(-1)} style={btn} aria-label="Previous variant">
        ‹
      </button>
      <div style={{ textAlign: 'center', minWidth: 0 }}>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {v.key} — {v.name}
        </div>
        {readout && (
          <div style={{ fontWeight: 400, opacity: 0.7, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            {readout}
          </div>
        )}
      </div>
      <button type="button" onClick={() => go(1)} style={btn} aria-label="Next variant">
        ›
      </button>
    </div>,
    document.body,
  );
}

const btn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 999,
  border: 0,
  background: '#333',
  color: '#fff',
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
};
