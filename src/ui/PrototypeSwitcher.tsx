// PROTOTYPE — throwaway. A floating bar that cycles `?variant=` on the current
// URL. Dev builds only: App mounts it behind `import.meta.env.DEV`, so a stray
// merge cannot ship the bar.

import { useEffect } from 'react';

export interface PrototypeVariant {
  key: string;
  name: string;
}

export function readVariant(variants: PrototypeVariant[]): string {
  const v = new URLSearchParams(window.location.search).get('variant');
  return variants.some((x) => x.key === v) ? (v as string) : variants[0].key;
}

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
  onReplay,
}: {
  variants: PrototypeVariant[];
  current: string;
  onChange: (key: string) => void;
  onReplay: () => void;
}) {
  const i = Math.max(0, variants.findIndex((v) => v.key === current));

  const go = (step: number) => {
    const next = variants[(i + step + variants.length) % variants.length].key;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.history.replaceState(null, '', url);
    onChange(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, [contenteditable]') || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Capture, so Leaflet's keyboard pan never sees the arrow.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const v = variants[i];
  return (
    <div className="proto-switcher" data-prototype-chrome>
      <button onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span>
        {v.key} — {v.name}
      </span>
      <button onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
      <button onClick={onReplay} aria-label="Show the title again" title="Show the title again">
        ↺
      </button>
    </div>
  );
}
