import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { saveViewState } from '../state/viewState';
import { LogoMark } from './LogoMark';
import { KEY_RANK } from '../state/keys';
import { useKeyLayer } from './useKeyLayer';
import { copy } from '../copy';

// The first impression (issue #76): a title cartouche over the map, so a new
// visitor can say what the app is within three seconds. It shows until the
// first tap, pan or zoom, and only until it has been dismissed once.
//
// It never takes a tap. The map under it stays fully usable, so the gesture
// that dismisses the card also does what the reader meant by it.
//
// It doubles as the loading state on a first visit, which is the one launch
// with no service worker and a cold download of the site data: the triskele
// turns and the hint says so until the sites are in.
export function TitleCard({ onClosed }: { onClosed: () => void }) {
  const dataLoaded = useStore((s) => s.dataLoaded);
  const [leaving, setLeaving] = useState(false);

  // A passive key layer: any key dismisses the card, and the same key still
  // reaches whatever it was meant for.
  useKeyLayer(!leaving, KEY_RANK.list, () => {
    saveViewState({ titleSeen: true });
    setLeaving(true);
    return false;
  }, { passive: true });

  useEffect(() => {
    if (leaving) return;
    // Capture phase on the window: Leaflet stops propagation on some of its
    // own events, and any first touch of the app counts, not only the map.
    const dismiss = () => {
      saveViewState({ titleSeen: true });
      setLeaving(true);
    };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('wheel', dismiss, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('wheel', dismiss, true);
    };
  }, [leaving]);

  return (
    <div
      className={leaving ? 'title-card leaving' : 'title-card'}
      onAnimationEnd={(e) => {
        if (e.animationName === 'title-card-out') onClosed();
      }}
    >
      <div className="title-card-plate">
        <LogoMark className="title-card-seal" spinning={!dataLoaded} />
        <h1 className="title-card-name">{copy.title.name}</h1>
        <p className="title-card-sub">{copy.title.sub}</p>
        <div className="title-card-hint" aria-live="polite">
          {dataLoaded ? copy.title.begin : copy.title.loading}
        </div>
      </div>
    </div>
  );
}
